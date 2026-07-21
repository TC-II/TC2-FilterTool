use crate::{
    bessel_delay_prototype, cauer_order, gauss_prototype, group_delay, legendre_prototype,
    lowpass_to_bandpass, lowpass_to_bandreject, lowpass_to_highpass, scale_frequency, C64, Zpk,
};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

const MAX_ORDER: usize = 50;

#[derive(Clone, Debug, Deserialize)]
#[allow(non_snake_case)]
pub struct DesignRequest {
    pub filter_type: u8,
    pub approx_type: u8,
    pub N_min: usize,
    pub N_max: usize,
    pub ap_dB: f64,
    pub aa_dB: f64,
    pub gain: f64,
    #[serde(default)]
    pub denorm: f64,
    #[serde(default)]
    pub define_with: u8,
    pub wp: ScalarOrPair,
    pub wa: ScalarOrPair,
    #[serde(default)]
    pub w0: f64,
    #[serde(default)]
    pub bw: [f64; 2],
    #[serde(default)]
    pub gamma: f64,
    #[serde(default)]
    pub tau0: f64,
    #[serde(default)]
    pub wrg: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum ScalarOrPair {
    Scalar(f64),
    Pair([f64; 2]),
}

impl ScalarOrPair {
    fn scalar(&self) -> Result<f64, String> {
        match self {
            Self::Scalar(value) => Ok(*value),
            Self::Pair(_) => Err("expected a scalar frequency".into()),
        }
    }

    fn pair(&self) -> Result<[f64; 2], String> {
        match self {
            Self::Pair(value) => Ok(*value),
            Self::Scalar(_) => Err("expected a frequency pair".into()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
pub struct DesignResponse {
    pub zeros: Vec<[f64; 2]>,
    pub poles: Vec<[f64; 2]>,
    pub num: Vec<f64>,
    pub den: Vec<f64>,
    pub gain: f64,
    pub N: usize,
}

#[derive(Clone, Debug, Serialize)]
#[allow(non_snake_case)]
pub struct BodeResponse {
    pub freq: Vec<f64>,
    pub magnitude: Vec<f64>,
    pub phase: Vec<f64>,
    pub groupDelay: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StageResponse {
    pub num: Vec<f64>,
    pub den: Vec<f64>,
    pub gain: f64,
}

pub fn filter_design(request: &DesignRequest) -> Result<DesignResponse, String> {
    validate(request)?;
    let (wan, wp, w0, pass_bw, _stop_bw) = normalized_parameters(request)?;
    let (order, mut prototype) = select_prototype(request, wan)?;

    if request.filter_type != 4 {
        prototype = denormalize_percentage(prototype, wan, request, order)?;
    }

    let mut zpk = match request.filter_type {
        0 => scale_frequency(&prototype, wp),
        1 => lowpass_to_highpass(&prototype, wp),
        2 => lowpass_to_bandpass(&prototype, w0, pass_bw),
        // Band-reject uses the outer (pass) bandwidth, matching Filter.py bw[1].
        3 => lowpass_to_bandreject(&prototype, w0, pass_bw),
        4 => scale_frequency(&prototype, 1.0 / request.tau0),
        _ => unreachable!(),
    };
    zpk.gain *= request.gain;

    let (num, den) = zpk_to_ba_monic(&zpk);
    Ok(DesignResponse {
        zeros: pairs(&zpk.zeros),
        poles: pairs(&zpk.poles),
        num,
        den,
        // Matches AnalogFilter/TFunction.gain bookkeeping in the Pyodide worker.
        gain: request.gain,
        N: order,
    })
}

fn validate(r: &DesignRequest) -> Result<(), String> {
    if r.N_min < 1 || r.N_max > MAX_ORDER || r.N_min > r.N_max {
        return Err("invalid filter order range (required: 1 <= N_min <= N_max <= 50)".into());
    }
    if !(r.ap_dB > 0.0 && r.aa_dB > r.ap_dB) {
        return Err("attenuation must satisfy 0 < ap_dB < aa_dB".into());
    }
    if r.approx_type > 6 || r.filter_type > 4 {
        return Err("unsupported filter or approximation type".into());
    }
    match r.filter_type {
        0 => {
            if !(r.wp.scalar()? > 0.0 && r.wp.scalar()? < r.wa.scalar()?) {
                return Err("low-pass frequencies must satisfy 0 < wp < wa".into());
            }
        }
        1 => {
            if !(r.wa.scalar()? > 0.0 && r.wa.scalar()? < r.wp.scalar()?) {
                return Err("high-pass frequencies must satisfy 0 < wa < wp".into());
            }
        }
        2 | 3 => {
            let wp = r.wp.pair()?;
            let wa = r.wa.pair()?;
            if r.define_with == 0 {
                let valid = if r.filter_type == 2 {
                    wa[0] < wp[0] && wp[0] < wp[1] && wp[1] < wa[1]
                } else {
                    wp[0] < wa[0] && wa[0] < wa[1] && wa[1] < wp[1]
                };
                if !valid {
                    return Err("invalid band-edge frequency ordering".into());
                }
            } else if !(r.w0 > 0.0 && r.bw[0] > 0.0 && r.bw[0] < r.bw[1]) {
                return Err("band filters require w0 > 0 and 0 < pass bandwidth < stop bandwidth".into());
            }
        }
        4 => {
            if !(r.gamma > 0.0 && r.gamma < 100.0 && r.tau0 > 0.0 && r.wrg > 0.0) {
                return Err("group delay requires 0 < gamma < 100, tau0 > 0 and wrg > 0".into());
            }
            if r.approx_type != 5 && r.approx_type != 6 {
                return Err("group delay supports only Bessel and Gauss approximations".into());
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}

/// Returns normalized stop edge, physical pass edge, center, pass BW, stop BW.
fn normalized_parameters(r: &DesignRequest) -> Result<(f64, f64, f64, f64, f64), String> {
    match r.filter_type {
        0 => Ok((r.wa.scalar()? / r.wp.scalar()?, r.wp.scalar()?, 0.0, 0.0, 0.0)),
        1 => Ok((r.wp.scalar()? / r.wa.scalar()?, r.wp.scalar()?, 0.0, 0.0, 0.0)),
        2 => {
            if r.define_with == 1 {
                Ok((r.bw[1] / r.bw[0], 0.0, r.w0, r.bw[0], r.bw[1]))
            } else {
                let p = r.wp.pair()?;
                let mut a = r.wa.pair()?;
                let w0 = (p[0] * p[1]).sqrt();
                let lo = w0 * w0 / a[1];
                let hi = w0 * w0 / a[0];
                if lo > a[0] { a[0] = lo; } else if hi < a[1] { a[1] = hi; }
                let pb = p[1] - p[0];
                let sb = a[1] - a[0];
                Ok((sb / pb, 0.0, w0, pb, sb))
            }
        }
        3 => {
            if r.define_with == 1 {
                Ok((r.bw[1] / r.bw[0], 0.0, r.w0, r.bw[1], r.bw[0]))
            } else {
                let a = r.wa.pair()?;
                let mut p = r.wp.pair()?;
                let w0 = (a[0] * a[1]).sqrt();
                let lo = w0 * w0 / p[1];
                let hi = w0 * w0 / p[0];
                if lo > p[0] { p[0] = lo; } else if hi < p[1] { p[1] = hi; }
                let sb = a[1] - a[0];
                let pb = p[1] - p[0];
                Ok((pb / sb, 0.0, w0, pb, sb))
            }
        }
        4 => Ok((r.wrg * r.tau0, 0.0, 0.0, 0.0, 0.0)),
        _ => unreachable!(),
    }
}

fn select_prototype(r: &DesignRequest, wan: f64) -> Result<(usize, Zpk), String> {
    if r.filter_type == 4 {
        for n in r.N_min..=r.N_max {
            let mut zpk = if r.approx_type == 5 {
                bessel_delay_prototype(n)
            } else {
                gauss_prototype(n)
            };
            let tau = group_delay(&zpk, 0.0);
            zpk = scale_frequency(&zpk, tau);
            if n == r.N_max || 1.0 - group_delay(&zpk, wan) <= r.gamma / 100.0 {
                return Ok((n, zpk));
            }
        }
        return Err("group-delay order selection failed".into());
    }

    let gp = 10_f64.powf(0.1 * r.ap_dB) - 1.0;
    let gs = 10_f64.powf(0.1 * r.aa_dB) - 1.0;
    match r.approx_type {
        0 => {
            let natural = (0.5 * (gs / gp).ln() / wan.ln()).ceil().max(1.0) as usize;
            // buttord's Wn uses the unclamped order, matching Filter.py.
            let wc = gp.powf(-0.5 / natural as f64);
            let n = natural.clamp(r.N_min, r.N_max);
            Ok((n, scale_frequency(&butterworth(n), wc)))
        }
        1 => {
            let natural = ((gs / gp).sqrt().acosh() / wan.acosh()).ceil().max(1.0) as usize;
            let n = natural.clamp(r.N_min, r.N_max);
            Ok((n, chebyshev1(n, r.ap_dB)))
        }
        2 => {
            let v = (gs / gp).sqrt().acosh();
            let natural = (v / wan.acosh()).ceil().max(1.0) as usize;
            // SciPy cheb2ord: wn = passb / (1/cosh(v/N)) = cosh(v/N) for passb=1.
            let wc = (v / natural as f64).cosh();
            let n = natural.clamp(r.N_min, r.N_max);
            Ok((n, scale_frequency(&chebyshev2(n, r.aa_dB), wc)))
        }
        3 => {
            let natural = cauer_order(1.0, wan, r.ap_dB, r.aa_dB);
            let n = natural.clamp(r.N_min, r.N_max);
            Ok((n, elliptic(n, r.ap_dB, r.aa_dB)?))
        }
        4 => {
            let eps = gp.sqrt();
            for n in r.N_min..=r.N_max {
                let zpk = legendre_prototype(n, eps);
                if n == r.N_max || response_abs(&zpk, wan) <= 10_f64.powf(-r.aa_dB / 20.0) {
                    return Ok((n, zpk));
                }
            }
            unreachable!()
        }
        5 | 6 => {
            for n in r.N_min..=r.N_max {
                let base = if r.approx_type == 5 {
                    bessel_phase_prototype(n)
                } else {
                    gauss_prototype(n)
                };
                let crossing = if r.approx_type == 5 {
                    bode_crossing_custom(&base, 10_f64.powf(-r.ap_dB / 20.0), wan, 30.0, 5.0, 100, 500)?
                } else {
                    bode_crossing_custom(&base, 10_f64.powf(-r.ap_dB / 20.0), wan, 10.0, 5.0, 100, 500)?
                };
                let zpk = scale_frequency(&base, 1.0 / crossing);
                if n == r.N_max || response_abs(&zpk, wan) <= 10_f64.powf(-r.aa_dB / 20.0) {
                    return Ok((n, zpk));
                }
            }
            unreachable!()
        }
        _ => Err("unsupported approximation".into()),
    }
}

fn butterworth(n: usize) -> Zpk {
    // SciPy buttap: m = -N+1, -N+3, ..., N-1
    let poles = (0..n)
        .map(|i| {
            let m = -((n as i32) + 1) + 2 + 2 * i as i32;
            -C64::from_polar(1.0, PI * m as f64 / (2.0 * n as f64))
        })
        .collect::<Vec<_>>();
    Zpk { zeros: vec![], poles, gain: 1.0 }
}

fn chebyshev1(n: usize, rp: f64) -> Zpk {
    // SciPy cheb1ap: p = -sinh(mu + j*theta)
    let eps = (10_f64.powf(0.1 * rp) - 1.0).sqrt();
    let mu = (1.0 / eps).asinh() / n as f64;
    let poles = (0..n)
        .map(|i| {
            let m = -((n as i32) + 1) + 2 + 2 * i as i32;
            let theta = PI * m as f64 / (2.0 * n as f64);
            C64::new(-mu.sinh() * theta.cos(), -mu.cosh() * theta.sin())
        })
        .collect::<Vec<_>>();
    let mut gain = signed_product(&poles);
    if n % 2 == 0 {
        gain /= (1.0 + eps * eps).sqrt();
    }
    Zpk { zeros: vec![], poles, gain }
}

fn chebyshev2(n: usize, rs: f64) -> Zpk {
    // SciPy cheb2ap
    let de = 1.0 / (10_f64.powf(0.1 * rs) - 1.0).sqrt();
    let mu = (1.0 / de).asinh() / n as f64;
    let mut zero_m = Vec::new();
    if n % 2 == 1 {
        let mut m = -(n as i32) + 1;
        while m < 0 {
            zero_m.push(m);
            m += 2;
        }
        m = 2;
        while m < n as i32 {
            zero_m.push(m);
            m += 2;
        }
    } else {
        let mut m = -(n as i32) + 1;
        while m < n as i32 {
            zero_m.push(m);
            m += 2;
        }
    }
    let zeros = zero_m
        .into_iter()
        .map(|m| {
            let s = (PI * m as f64 / (2.0 * n as f64)).sin();
            // -conj(1j / sin(...)) => 0 ± j/sin
            C64::new(0.0, -1.0 / s)
        })
        .collect::<Vec<_>>();
    let poles = (0..n)
        .map(|i| {
            let m = -((n as i32) + 1) + 2 + 2 * i as i32;
            let unit = -C64::from_polar(1.0, PI * m as f64 / (2.0 * n as f64));
            let warped = C64::new(mu.sinh() * unit.re, mu.cosh() * unit.im);
            C64::new(1.0, 0.0) / warped
        })
        .collect::<Vec<_>>();
    let gain = signed_product(&poles) / zeros.iter().map(|z| -*z).product::<C64>().re;
    Zpk { zeros, poles, gain }
}

fn bessel_phase_prototype(n: usize) -> Zpk {
    let delay = bessel_delay_prototype(n);
    let scale = delay.gain.powf(-1.0 / n as f64);
    scale_frequency(&delay, scale)
}

fn elliptic(n: usize, rp: f64, rs: f64) -> Result<Zpk, String> {
    if n == 0 {
        return Ok(Zpk { zeros: vec![], poles: vec![], gain: 10_f64.powf(-rp / 20.0) });
    }
    if n == 1 {
        let pole = -(1.0 / (10_f64.powf(0.1 * rp) - 1.0)).sqrt();
        return Ok(Zpk { zeros: vec![], poles: vec![C64::new(pole, 0.0)], gain: -pole });
    }
    let eps_sq = 10_f64.powf(0.1 * rp) - 1.0;
    let eps = eps_sq.sqrt();
    let m1 = eps_sq / (10_f64.powf(0.1 * rs) - 1.0);
    if m1 <= 0.0 || m1 >= 1.0 {
        return Err("elliptic selectivity ratio out of range".into());
    }
    let m = elliptic_degree(n, m1);
    let capk = elliptic_k_local(m);
    let k1 = elliptic_k_local(m1);

    let mut zeros = Vec::new();
    let mut pole_seeds = Vec::new();
    let start = 1 - (n % 2);
    for j in (start..n).step_by(2) {
        let (s, c, d) = jacobi(j as f64 * capk / n as f64, m);
        if s.abs() > 2e-16 {
            let z = C64::new(0.0, 1.0 / (m.sqrt() * s));
            zeros.push(z);
            zeros.push(z.conj());
        }
        pole_seeds.push((s, c, d));
    }

    let r = arc_jac_sc1(1.0 / eps, m1)?;
    let v0 = capk * r / (n as f64 * k1);
    let (sv, cv, dv) = jacobi(v0, 1.0 - m);

    let mut poles = Vec::new();
    for (s, c, d) in pole_seeds {
        let denominator = 1.0 - (d * sv).powi(2);
        let p = C64::new(
            -(c * d * sv * cv) / denominator,
            -(s * dv) / denominator,
        );
        poles.push(p);
    }
    if n % 2 == 1 {
        let complex_poles = poles.iter().copied().filter(|p| p.im.abs() > 2e-16 * p.norm().max(1.0)).collect::<Vec<_>>();
        for p in complex_poles {
            poles.push(p.conj());
        }
    } else {
        let base = poles.clone();
        for p in base {
            poles.push(p.conj());
        }
    }

    let mut gain = (poles.iter().map(|p| -*p).product::<C64>()
        / zeros.iter().map(|z| -*z).product::<C64>()).re;
    if n % 2 == 0 {
        gain /= (1.0 + eps_sq).sqrt();
    }
    if !gain.is_finite() {
        return Err("elliptic prototype failed to converge".into());
    }
    Ok(Zpk { zeros, poles, gain })
}

fn elliptic_degree(n: usize, m1: f64) -> f64 {
    let k1 = elliptic_k_local(m1);
    let k1p = elliptic_k_local(1.0 - m1);
    let q1 = (-PI * k1p / k1).exp();
    let q = q1.powf(1.0 / n as f64);
    let mut num = 0.0;
    let mut den = 1.0;
    for j in 0..=7 {
        num += q.powi((j * (j + 1)) as i32);
    }
    for j in 1..=8 {
        den += 2.0 * q.powi((j * j) as i32);
    }
    16.0 * q * (num / den).powi(4)
}

fn elliptic_k_local(m: f64) -> f64 {
    if m <= 0.0 {
        return PI / 2.0;
    }
    if m >= 1.0 {
        return f64::INFINITY;
    }
    let mut a = 1.0;
    let mut b = (1.0 - m).sqrt();
    for _ in 0..80 {
        let next = (a + b) * 0.5;
        b = (a * b).sqrt();
        if (next - a).abs() < 2e-16 * next.abs().max(1.0) {
            a = next;
            break;
        }
        a = next;
    }
    PI / (2.0 * a)
}

/// Real Jacobi sn/cn/dn using descending Landen/AGM, matching SciPy ellipj.
fn jacobi(u: f64, m: f64) -> (f64, f64, f64) {
    if m.abs() < 1e-16 {
        return (u.sin(), u.cos(), 1.0);
    }
    if (1.0 - m).abs() < 1e-16 {
        let c = 1.0 / u.cosh();
        return (u.tanh(), c, c);
    }
    let mut a = vec![1.0];
    let mut c = Vec::new();
    let mut b = (1.0 - m).sqrt();
    let mut twon = 1.0;
    for _ in 0..16 {
        let ci = (a[a.len() - 1] - b) * 0.5;
        c.push(ci);
        let next = (a[a.len() - 1] + b) * 0.5;
        b = (a[a.len() - 1] * b).sqrt();
        a.push(next);
        twon *= 2.0;
        if ci.abs() <= 2e-16 * next.abs() {
            break;
        }
    }
    let mut phi = twon * a[a.len() - 1] * u;
    for j in (0..c.len()).rev() {
        phi = 0.5 * (phi + (c[j] * phi.sin() / a[j + 1]).asin());
    }
    let sn = phi.sin();
    let cn = phi.cos();
    let dn = (1.0 - m * sn * sn).sqrt();
    (sn, cn, dn)
}

fn complement_k(kx: f64) -> f64 {
    ((1.0 - kx) * (1.0 + kx)).sqrt()
}

/// SciPy `_arc_jac_sc1`: solve w = sc(z, 1-m) for real z.
fn arc_jac_sc1(w: f64, m: f64) -> Result<f64, String> {
    // sc(z, 1-m) = -i * sn(i*z, m)  =>  sn(i*z, m) = i*w
    let z = arc_jac_sn(C64::new(0.0, w), m)?;
    if z.re.abs() > 1e-12 {
        return Err("arc_jac_sc1 produced a complex result".into());
    }
    Ok(z.im)
}

fn arc_jac_sn(w: C64, m: f64) -> Result<C64, String> {
    let k = m.sqrt();
    if k > 1.0 {
        return Err("elliptic modulus > 1".into());
    }
    if (k - 1.0).abs() < 1e-15 {
        return Ok(((C64::new(1.0, 0.0) + w) / (C64::new(1.0, 0.0) - w)).ln() * 0.5);
    }
    let mut ks = vec![k];
    for _ in 0..10 {
        let k_ = *ks.last().unwrap();
        if k_.abs() < 1e-16 {
            break;
        }
        let kp = complement_k(k_);
        ks.push((1.0 - kp) / (1.0 + kp));
    }
    let mut kprod = 1.0;
    for value in ks.iter().skip(1) {
        kprod *= 1.0 + *value;
    }
    let big_k = kprod * PI / 2.0;
    let mut wn = w;
    for (kn, knext) in ks.iter().zip(ks.iter().skip(1)) {
        let kn_wn = wn * *kn;
        let complement = ((C64::new(1.0, 0.0) - kn_wn) * (C64::new(1.0, 0.0) + kn_wn)).sqrt();
        wn = (wn * 2.0) / ((1.0 + knext) * (C64::new(1.0, 0.0) + complement));
    }
    let u = wn.asin() * (2.0 / PI);
    Ok(u * big_k)
}

fn denormalize_percentage(mut zpk: Zpk, wan: f64, r: &DesignRequest, _n: usize) -> Result<Zpk, String> {
    let amount = r.denorm / 100.0;
    let ga = 10_f64.powf(-r.aa_dB / 20.0);
    let gp = 10_f64.powf(-r.ap_dB / 20.0);
    // Match Filter.py getBodeMagFast grids (use_hz=False) used for denormalization.
    let wd = bode_crossing_high_to_low(&zpk, ga, wan, 100, 2000)?;
    let mut transform = ((1.0 - amount) * wan + amount * wd) / wan;
    if r.approx_type == 2 {
        let pass_crossing = bode_crossing_high_to_low(&zpk, gp, wan, 100, 2000)?;
        transform *= amount + (1.0 - amount) * pass_crossing;
    }
    zpk = scale_frequency(&zpk, 1.0 / transform);
    Ok(zpk)
}

/// Approximate Filter.py's reversed log-spaced magnitude scan for a level crossing.
fn bode_crossing_high_to_low(
    zpk: &Zpk,
    level: f64,
    wan: f64,
    coarse: usize,
    fine: usize,
) -> Result<f64, String> {
    bode_crossing_custom(zpk, level, wan, 30.0, 30.0, coarse, fine)
}

fn bode_crossing_custom(
    zpk: &Zpk,
    level: f64,
    wan: f64,
    start_factor: f64,
    stop_factor: f64,
    coarse: usize,
    fine: usize,
) -> Result<f64, String> {
    let start = (1.0 / (start_factor * wan * 2.0 * PI)).log10();
    let stop = (stop_factor * wan / (2.0 * PI)).log10();
    let sample = |points: usize, a: f64, b: f64| -> Vec<(f64, f64)> {
        (0..points)
            .map(|i| {
                let t = if points == 1 { 0.0 } else { i as f64 / (points - 1) as f64 };
                let omega = 10_f64.powf(a + t * (b - a));
                (omega, response_abs(zpk, omega))
            })
            .collect()
    };
    let coarse_points = sample(coarse, start, stop);
    for i in (0..coarse_points.len()).rev() {
        if coarse_points[i].1 > level {
            let lo_idx = i.saturating_sub(1);
            let hi_idx = (i + 1).min(coarse_points.len() - 1);
            let local_start = coarse_points[lo_idx].0.log10();
            let local_stop = coarse_points[hi_idx].0.log10();
            let fine_points = sample(fine, local_start, local_stop);
            for j in (0..fine_points.len()).rev() {
                if fine_points[j].1 >= level {
                    return Ok(fine_points[j].0);
                }
            }
            return Ok(coarse_points[i].0);
        }
    }
    Err("could not locate attenuation crossing".into())
}

fn response_abs(zpk: &Zpk, omega: f64) -> f64 {
    response_zpk(zpk, omega).norm()
}

fn response_zpk(zpk: &Zpk, omega: f64) -> C64 {
    eval_zpk(zpk, C64::new(0.0, omega))
}

fn eval_zpk(zpk: &Zpk, s: C64) -> C64 {
    // Log-magnitude evaluation stays finite for order-50 designs.
    let mut log_mag = zpk.gain.abs().max(1e-300).ln();
    let mut phase = if zpk.gain < 0.0 { PI } else { 0.0 };
    for zero in &zpk.zeros {
        let value = s - zero;
        let mag = value.norm().max(1e-300);
        log_mag += mag.ln();
        phase += value.arg();
    }
    for pole in &zpk.poles {
        let value = s - pole;
        let mag = value.norm().max(1e-300);
        log_mag -= mag.ln();
        phase -= value.arg();
    }
    C64::from_polar(log_mag.exp(), phase)
}

pub fn compute_bode(num: &[f64], den: &[f64], min_hz: f64, max_hz: f64, points: usize) -> Result<BodeResponse, String> {
    if num.is_empty() || den.is_empty() || points == 0 || !(min_hz > 0.0 && max_hz >= min_hz) {
        return Err("invalid Bode arguments".into());
    }
    let mut num_asc: Vec<f64> = num.iter().copied().rev().collect();
    let mut den_asc: Vec<f64> = den.iter().copied().rev().collect();
    while num_asc.last().is_some_and(|v| v.abs() < 1e-300) { num_asc.pop(); }
    while den_asc.last().is_some_and(|v| v.abs() < 1e-300) { den_asc.pop(); }
    let zeros = crate::polynomial_roots(&num_asc);
    let poles = crate::polynomial_roots(&den_asc);
    let gain = if den[0].abs() > 0.0 { num[0] / den[0] } else { num[0] };
    let zpk = Zpk { zeros: zeros.clone(), poles: poles.clone(), gain };
    let use_zpk = poles.iter().all(|p| p.is_finite())
        && zeros.iter().all(|z| z.is_finite())
        && poles.len() == den_asc.len().saturating_sub(1);
    compute_bode_zpk_or_ba(&zpk, num, den, use_zpk, min_hz, max_hz, points)
}

pub fn compute_bode_from_zpk(
    zeros: &[[f64; 2]],
    poles: &[[f64; 2]],
    gain: f64,
    min_hz: f64,
    max_hz: f64,
    points: usize,
) -> Result<BodeResponse, String> {
    let zpk = Zpk {
        zeros: zeros.iter().map(|v| C64::new(v[0], v[1])).collect(),
        poles: poles.iter().map(|v| C64::new(v[0], v[1])).collect(),
        gain,
    };
    compute_bode_zpk_or_ba(&zpk, &[], &[], true, min_hz, max_hz, points)
}

fn compute_bode_zpk_or_ba(
    zpk: &Zpk,
    num: &[f64],
    den: &[f64],
    use_zpk: bool,
    min_hz: f64,
    max_hz: f64,
    points: usize,
) -> Result<BodeResponse, String> {
    let mut response = BodeResponse {
        freq: Vec::with_capacity(points),
        magnitude: Vec::with_capacity(points),
        phase: Vec::with_capacity(points),
        groupDelay: Vec::with_capacity(points),
    };
    for i in 0..points {
        let t = if points == 1 { 0.0 } else { i as f64 / (points - 1) as f64 };
        let f = 10_f64.powf(min_hz.log10() + t * (max_hz.log10() - min_hz.log10()));
        let omega = 2.0 * PI * f;
        let s = C64::new(0.0, omega);
        let h = if use_zpk {
            eval_zpk(zpk, s)
        } else {
            eval_desc(num, s) / eval_desc(den, s)
        };
        let mut phase = zpk.zeros.iter().map(|z| (s - z).arg()).sum::<f64>()
            - zpk.poles.iter().map(|p| (s - p).arg()).sum::<f64>();
        if zpk.gain < 0.0 {
            phase += PI;
        }
        if !phase.is_finite() {
            phase = h.arg();
        }
        let magnitude = if h.is_finite() { h.norm() } else {
            (eval_desc(num, s) / eval_desc(den, s)).norm()
        };
        response.freq.push(f);
        response.magnitude.push(magnitude);
        response.phase.push(phase * 180.0 / PI);
        response.groupDelay.push(group_delay(zpk, omega));
    }
    Ok(response)
}

pub fn build_stage(zeros: &[[f64; 2]], poles: &[[f64; 2]], gain: f64, norm: &str, filter_type: u8) -> Result<StageResponse, String> {
    if poles.is_empty() || poles.len() > 2 || zeros.len() > poles.len() {
        return Err("a stage requires one or two poles and no more zeros than poles".into());
    }
    let zeros = zeros.iter().map(|v| C64::new(v[0], v[1])).collect::<Vec<_>>();
    let poles = poles.iter().map(|v| C64::new(v[0], v[1])).collect::<Vec<_>>();
    let resolved = if norm == "Passband" {
        match filter_type { 1 => "ω→∞", 2 => "ω→ω0", _ => "ω→0" }
    } else { norm };
    let norm_gain = match resolved {
        "ω→0" => {
            let pp = poles.iter().filter(|p| p.norm() >= 1e-5).copied().product::<C64>();
            let zp = zeros.iter().filter(|z| z.norm() >= 1e-5).copied().product::<C64>();
            (pp / zp).norm()
        }
        "ω→∞" => 1.0,
        "ω→ω0" => {
            // Desktop Filter.py: norm_gain = 1 / |TFunction.at(|p0|)|, and
            // TFunction.at(w) calls SciPy freqresp which evaluates H(j·w).
            let base = Zpk { zeros: zeros.clone(), poles: poles.clone(), gain: 1.0 };
            let value = eval_zpk(&base, C64::new(0.0, poles[0].norm()));
            if value.norm() > 1e-12 { 1.0 / value.norm() } else { 1.0 }
        }
        _ => 1.0,
    };
    let stage_gain = norm_gain * gain;
    let zpk = Zpk { zeros, poles, gain: stage_gain };
    let (num, den) = zpk_to_ba_monic(&zpk);
    Ok(StageResponse { num, den, gain: stage_gain })
}

fn zpk_to_ba_monic(zpk: &Zpk) -> (Vec<f64>, Vec<f64>) {
    let mut num = roots_to_desc(&zpk.zeros);
    for value in &mut num { *value *= zpk.gain; }
    (num, roots_to_desc(&zpk.poles))
}

fn roots_to_desc(roots: &[C64]) -> Vec<f64> {
    let mut coefficients = vec![C64::new(1.0, 0.0)];
    for root in roots {
        let mut next = vec![C64::new(0.0, 0.0); coefficients.len() + 1];
        for (i, value) in coefficients.iter().enumerate() {
            next[i] += *value;
            next[i + 1] -= *value * *root;
        }
        coefficients = next;
    }
    coefficients.into_iter().map(|v| if v.re.abs() < 1e-300 { 0.0 } else { v.re }).collect()
}

fn eval_desc(coefficients: &[f64], x: C64) -> C64 {
    coefficients.iter().fold(C64::new(0.0, 0.0), |value, coefficient| value * x + coefficient)
}

fn signed_product(poles: &[C64]) -> f64 {
    poles.iter().map(|p| -*p).product::<C64>().re
}

fn pairs(values: &[C64]) -> Vec<[f64; 2]> {
    values.iter().map(|v| [v.re, v.im]).collect()
}
