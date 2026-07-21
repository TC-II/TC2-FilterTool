//! TC2 analog-filter numerical engine for native Rust and WebAssembly.

use num_complex::Complex64;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

mod engine;
pub use engine::{
    build_stage, compute_bode, compute_bode_from_zpk, filter_design, BodeResponse,
    DesignRequest, DesignResponse, ScalarOrPair, StageResponse,
};

pub type C64 = Complex64;

#[derive(Clone, Debug)]
pub struct Zpk {
    pub zeros: Vec<C64>,
    pub poles: Vec<C64>,
    pub gain: f64,
}

pub trait PrototypeProvider {
    fn cauer_order(&self, wp: f64, ws: f64, rp_db: f64, rs_db: f64) -> usize;
    fn cauer_prototype(&self, order: usize, rp_db: f64, rs_db: f64) -> Option<Zpk>;
}

/// Project-owned adapter boundary for an external signal crate.
///
/// `scirs2-signal` was evaluated for this spike, but is intentionally not a
/// dependency: its broad ndarray/scientific stack is disproportionate for a
/// browser WASM core, and its API does not cover TC2's Legendre/Gauss paths.
/// A later crate can be evaluated without leaking its types past this trait.
pub struct ProjectOwned;

impl PrototypeProvider for ProjectOwned {
    fn cauer_order(&self, wp: f64, ws: f64, rp_db: f64, rs_db: f64) -> usize {
        cauer_order(wp, ws, rp_db, rs_db)
    }

    fn cauer_prototype(&self, order: usize, rp_db: f64, rs_db: f64) -> Option<Zpk> {
        // The production implementation is consumed through filter_design.
        let request = DesignRequest {
            filter_type: 0,
            approx_type: 3,
            N_min: order,
            N_max: order,
            ap_dB: rp_db,
            aa_dB: rs_db,
            gain: 1.0,
            denorm: 0.0,
            define_with: 1,
            wp: ScalarOrPair::Scalar(1.0),
            wa: ScalarOrPair::Scalar(2.0),
            w0: 0.0,
            bw: [0.0, 0.0],
            gamma: 5.0,
            tau0: 1.0,
            wrg: 0.0,
        };
        filter_design(&request).ok().map(|value| Zpk {
            zeros: value.zeros.into_iter().map(|v| C64::new(v[0], v[1])).collect(),
            poles: value.poles.into_iter().map(|v| C64::new(v[0], v[1])).collect(),
            gain: value.num.first().copied().unwrap_or(1.0) / value.den.first().copied().unwrap_or(1.0),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Transform {
    LowPass,
    HighPass,
    BandPass,
    BandReject,
    GroupDelay,
}

/// Elliptic/Cauer minimum order, matching the standard complete-elliptic
/// integral expression used by SciPy's analog `ellipord`.
pub fn cauer_order(wp: f64, ws: f64, rp_db: f64, rs_db: f64) -> usize {
    let nat = ws / wp;
    let gpass = 10_f64.powf(0.1 * rp_db) - 1.0;
    let gstop = 10_f64.powf(0.1 * rs_db) - 1.0;
    let k = 1.0 / nat;
    let k1 = (gpass / gstop).sqrt();
    let n = elliptic_k(k * k) * elliptic_k(1.0 - k1 * k1)
        / (elliptic_k(1.0 - k * k) * elliptic_k(k1 * k1));
    n.ceil().max(1.0) as usize
}

/// Complete elliptic integral K(m), with parameter `m`.
fn elliptic_k(m: f64) -> f64 {
    assert!((0.0..1.0).contains(&m) || m == 0.0);
    let mut a = 1.0;
    let mut b = (1.0 - m).sqrt();
    for _ in 0..64 {
        let next = (a + b) * 0.5;
        b = (a * b).sqrt();
        if (next - a).abs() <= 4.0 * f64::EPSILON * next {
            a = next;
            break;
        }
        a = next;
    }
    PI / (2.0 * a)
}

/// Repository-specific `get_Leps`, represented as ascending coefficients in
/// the frequency variable.  This mirrors NumPy Legendre->Polynomial,
/// squaring, integration, and composition with `2*w^2 - 1`.
pub fn legendre_leps(order: usize, epsilon: f64) -> Vec<f64> {
    assert!(order > 0);
    let k = if order % 2 == 0 {
        order / 2 - 1
    } else {
        (order - 1) / 2
    };
    let mut leg = vec![0.0; k + 1];
    for i in 0..=k {
        leg[i] = if order % 2 == 0 {
            if k % 2 == 0 {
                if i == 0 {
                    1.0 / (((k + 1) * (k + 2)) as f64).sqrt()
                } else if i % 2 == 0 {
                    (2 * i + 1) as f64 * leg[0]
                } else {
                    0.0
                }
            } else if i == 1 {
                3.0 / (((k + 1) * (k + 2)) as f64).sqrt()
            } else if i % 2 == 0 {
                0.0
            } else {
                (2 * i + 1) as f64 * leg[1] / 3.0
            }
        } else if i == 0 {
            1.0 / (2.0_f64.sqrt() * (k + 1) as f64)
        } else {
            (2 * i + 1) as f64 * leg[0]
        };
    }

    let power = legendre_to_power(&leg);
    let mut integrand = mul_poly(&power, &power);
    if order % 2 == 0 {
        integrand = mul_poly(&integrand, &[1.0, 1.0]);
    }
    let mut integral = vec![0.0; integrand.len() + 1];
    for (i, coefficient) in integrand.iter().enumerate() {
        integral[i + 1] = coefficient / (i + 1) as f64;
    }
    let at_minus_one = eval_real_poly(&integral, -1.0);
    let mut composed = compose_poly(&integral, &[-1.0, 0.0, 2.0]);
    for value in &mut composed {
        *value *= epsilon * epsilon;
    }
    composed[0] += 1.0 - epsilon * epsilon * at_minus_one;
    trim(&mut composed);
    composed
}

/// Stable LHP poles selected exactly as `select_roots` in Filter.py.
pub fn legendre_prototype(order: usize, epsilon: f64) -> Zpk {
    let roots = polynomial_roots(&legendre_leps(order, epsilon));
    let poles: Vec<_> = roots
        .into_iter()
        .map(|root| root * C64::new(0.0, -1.0))
        .filter(|root| root.re <= 1e-8)
        .collect();
    let gain = signed_pole_product(&poles, order);
    Zpk { zeros: vec![], poles, gain }
}

/// Repository-specific Gauss denominator `[1, 0, 1, 0, 1/2!, ...]`.
pub fn gauss_prototype(order: usize) -> Zpk {
    assert!(order > 0);
    let mut polynomial = vec![1.0];
    let mut factorial = 1.0;
    for n in 1..=order {
        factorial *= n as f64;
        polynomial.push(0.0);
        polynomial.push(1.0 / factorial);
    }
    let poles: Vec<_> = polynomial_roots(&polynomial)
        .into_iter()
        .map(|root| root * C64::new(0.0, -1.0))
        .filter(|root| root.re <= 1e-8)
        .collect();
    let gain = signed_pole_product(&poles, order);
    Zpk { zeros: vec![], poles, gain }
}

/// Reverse Bessel polynomial with SciPy's delay normalization.
pub fn bessel_delay_prototype(order: usize) -> Zpk {
    assert!(order > 0);
    let mut denominator = Vec::with_capacity(order + 1);
    for k in 0..=order {
        denominator.push(
            factorial(2 * order - k)
                / (2_f64.powi((order - k) as i32)
                    * factorial(k)
                    * factorial(order - k)),
        );
    }
    let poles = polynomial_roots(&denominator);
    Zpk { zeros: vec![], poles, gain: denominator[0] }
}

pub fn group_delay(zpk: &Zpk, omega: f64) -> f64 {
    let contributions = |roots: &[C64]| {
        roots.iter().map(|r| {
            -r.re / (r.re * r.re + (omega - r.im) * (omega - r.im))
        }).sum::<f64>()
    };
    contributions(&zpk.poles) - contributions(&zpk.zeros)
}

pub fn select_group_delay_order<F>(
    min_order: usize,
    max_order: usize,
    omega_normalized: f64,
    allowed_drop: f64,
    prototype: F,
) -> (usize, Zpk)
where
    F: Fn(usize) -> Zpk,
{
    for order in min_order..=max_order {
        let mut zpk = prototype(order);
        let tau0 = group_delay(&zpk, 0.0);
        for pole in &mut zpk.poles {
            *pole *= tau0;
        }
        zpk.gain = signed_pole_product(&zpk.poles, order);
        if order == max_order || 1.0 - group_delay(&zpk, omega_normalized) <= allowed_drop {
            return (order, zpk);
        }
    }
    unreachable!()
}

pub fn scale_frequency(zpk: &Zpk, omega: f64) -> Zpk {
    let degree = zpk.poles.len() - zpk.zeros.len();
    Zpk {
        zeros: zpk.zeros.iter().map(|z| z * omega).collect(),
        poles: zpk.poles.iter().map(|p| p * omega).collect(),
        gain: zpk.gain * omega.powi(degree as i32),
    }
}

pub fn lowpass_to_highpass(zpk: &Zpk, omega: f64) -> Zpk {
    let degree = zpk.poles.len() - zpk.zeros.len();
    let frequency = C64::new(omega, 0.0);
    let mut zeros: Vec<_> = zpk.zeros.iter().map(|z| frequency / *z).collect();
    zeros.extend((0..degree).map(|_| C64::new(0.0, 0.0)));
    let poles: Vec<_> = zpk.poles.iter().map(|p| frequency / *p).collect();
    let numerator = zpk.zeros.iter().fold(C64::new(1.0, 0.0), |a, z| a * -z);
    let denominator = zpk.poles.iter().fold(C64::new(1.0, 0.0), |a, p| a * -p);
    Zpk { zeros, poles, gain: zpk.gain * (numerator / denominator).re }
}

pub fn lowpass_to_bandpass(zpk: &Zpk, omega0: f64, bandwidth: f64) -> Zpk {
    let degree = zpk.poles.len() - zpk.zeros.len();
    let split = |root: C64| {
        let b = root * bandwidth;
        let d = (b * b - C64::new(4.0 * omega0 * omega0, 0.0)).sqrt();
        [(b + d) * 0.5, (b - d) * 0.5]
    };
    let mut zeros: Vec<_> = zpk.zeros.iter().flat_map(|z| split(*z)).collect();
    zeros.extend((0..degree).map(|_| C64::new(0.0, 0.0)));
    let poles = zpk.poles.iter().flat_map(|p| split(*p)).collect();
    Zpk { zeros, poles, gain: zpk.gain * bandwidth.powi(degree as i32) }
}

pub fn lowpass_to_bandreject(zpk: &Zpk, omega0: f64, bandwidth: f64) -> Zpk {
    let degree = zpk.poles.len() - zpk.zeros.len();
    let split = |root: C64| {
        let b = C64::new(bandwidth, 0.0) / root;
        let d = (b * b - C64::new(4.0 * omega0 * omega0, 0.0)).sqrt();
        [(b + d) * 0.5, (b - d) * 0.5]
    };
    let mut zeros: Vec<_> = zpk.zeros.iter().flat_map(|z| split(*z)).collect();
    for _ in 0..degree {
        zeros.push(C64::new(0.0, omega0));
        zeros.push(C64::new(0.0, -omega0));
    }
    let poles = zpk.poles.iter().flat_map(|p| split(*p)).collect();
    // SciPy lp2bs_zpk: k_bs = k * real(prod(-z)/prod(-p))
    let numerator = zpk.zeros.iter().fold(C64::new(1.0, 0.0), |a, z| a * -z);
    let denominator = zpk.poles.iter().fold(C64::new(1.0, 0.0), |a, p| a * -p);
    Zpk {
        zeros,
        poles,
        gain: zpk.gain * (numerator / denominator).re,
    }
}

#[wasm_bindgen]
pub fn risk_spike_capabilities() -> String {
    "filter-design,bode,stage,cauer,legendre,gauss,bessel,lp,hp,bp,br,gd,zpk,sos".into()
}

#[wasm_bindgen(js_name = filterDesign)]
pub fn filter_design_wasm(request: JsValue) -> Result<JsValue, JsValue> {
    let request: DesignRequest = serde_wasm_bindgen::from_value(request)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    match filter_design(&request) {
        Ok(value) => serde_wasm_bindgen::to_value(&value)
            .map_err(|error| JsValue::from_str(&error.to_string())),
        Err(error) => {
            let value = serde_json_compat_error(&error);
            serde_wasm_bindgen::to_value(&value)
                .map_err(|error| JsValue::from_str(&error.to_string()))
        }
    }
}

#[wasm_bindgen(js_name = computeBode)]
pub fn compute_bode_wasm(
    num: Vec<f64>,
    den: Vec<f64>,
    freq_min_hz: Option<f64>,
    freq_max_hz: Option<f64>,
    num_points: Option<usize>,
) -> Result<JsValue, JsValue> {
    let value = compute_bode(
        &num,
        &den,
        freq_min_hz.unwrap_or(0.1),
        freq_max_hz.unwrap_or(1e5),
        num_points.unwrap_or(2000),
    ).map_err(|error| JsValue::from_str(&error))?;
    serde_wasm_bindgen::to_value(&value).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = buildStageFromZPK)]
pub fn build_stage_wasm(
    zeros: JsValue,
    poles: JsValue,
    gain: f64,
    normtype: Option<String>,
    filter_type: Option<u8>,
) -> Result<JsValue, JsValue> {
    let zeros: Vec<[f64; 2]> = serde_wasm_bindgen::from_value(zeros)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let poles: Vec<[f64; 2]> = serde_wasm_bindgen::from_value(poles)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let value = build_stage(
        &zeros,
        &poles,
        gain,
        normtype.as_deref().unwrap_or("Passband"),
        filter_type.unwrap_or(0),
    ).map_err(|error| JsValue::from_str(&error))?;
    serde_wasm_bindgen::to_value(&value).map_err(|error| JsValue::from_str(&error.to_string()))
}

mod serde_json_compat {
    use serde::Serialize;

    #[derive(Serialize)]
    pub struct ErrorValue<'a> {
        pub error: &'a str,
    }
}

fn serde_json_compat_error(error: &str) -> serde_json_compat::ErrorValue<'_> {
    serde_json_compat::ErrorValue { error }
}

fn factorial(n: usize) -> f64 {
    (1..=n).fold(1.0, |a, value| a * value as f64)
}

fn signed_pole_product(poles: &[C64], order: usize) -> f64 {
    let product = poles.iter().product::<C64>();
    (product * if order % 2 == 0 { 1.0 } else { -1.0 }).re
}

fn legendre_to_power(coefficients: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0];
    let mut p0 = vec![1.0];
    let mut p1 = vec![0.0, 1.0];
    for (n, coefficient) in coefficients.iter().enumerate() {
        let basis = if n == 0 { &p0 } else { &p1 };
        add_scaled(&mut result, basis, *coefficient);
        if n + 1 < coefficients.len() && n >= 1 {
            let mut next = mul_poly(&p1, &[0.0, (2 * n + 1) as f64]);
            add_scaled(&mut next, &p0, -(n as f64));
            for value in &mut next {
                *value /= (n + 1) as f64;
            }
            p0 = p1;
            p1 = next;
        }
    }
    result
}

fn add_scaled(target: &mut Vec<f64>, source: &[f64], scale: f64) {
    target.resize(target.len().max(source.len()), 0.0);
    for (target, source) in target.iter_mut().zip(source) {
        *target += source * scale;
    }
}

fn mul_poly(a: &[f64], b: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0; a.len() + b.len() - 1];
    for (i, x) in a.iter().enumerate() {
        for (j, y) in b.iter().enumerate() {
            result[i + j] += x * y;
        }
    }
    result
}

fn compose_poly(outer: &[f64], inner: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0];
    for coefficient in outer.iter().rev() {
        result = mul_poly(&result, inner);
        result[0] += coefficient;
    }
    result
}

fn eval_real_poly(coefficients: &[f64], x: f64) -> f64 {
    coefficients.iter().rev().fold(0.0, |value, coefficient| value * x + coefficient)
}

fn eval_complex_poly(coefficients: &[f64], x: C64) -> C64 {
    coefficients.iter().rev().fold(C64::new(0.0, 0.0), |value, coefficient| {
        value * x + coefficient
    })
}

fn trim(polynomial: &mut Vec<f64>) {
    while polynomial.len() > 1 && polynomial.last().is_some_and(|x| x.abs() < 1e-15) {
        polynomial.pop();
    }
}

/// Durand-Kerner roots avoid a heavyweight BLAS/LAPACK dependency in WASM.
///
/// High-order analog filters at real cutoff frequencies produce monic
/// polynomials whose coefficients span an enormous dynamic range (e.g. an
/// order-8 low-pass at a few kHz has a constant term near `wc^8 ~ 1e30`).
/// Seeding Durand-Kerner from `1 + max|coef|` then places the initial guesses
/// ~1e30 away from roots of magnitude `wc`, so the iteration cannot converge.
/// We first factor out exact zero roots, then balance the polynomial by
/// scaling the variable so the remaining roots sit near unit magnitude, solve,
/// and rescale the results.
pub fn polynomial_roots(coefficients: &[f64]) -> Vec<C64> {
    let mut coefficients = coefficients.to_vec();
    trim(&mut coefficients);
    let mut order = coefficients.len().saturating_sub(1);
    if order == 0 {
        return vec![];
    }
    let leading = coefficients[order];
    if !leading.is_finite() || leading == 0.0 {
        return vec![];
    }
    for coefficient in &mut coefficients {
        *coefficient /= leading;
    }

    // Peel off roots at the origin so the variable scaling below stays finite.
    let mut zero_roots = 0usize;
    while order > 0 && coefficients[0].abs() < 1e-300 {
        coefficients.remove(0);
        order -= 1;
        zero_roots += 1;
    }
    if order == 0 {
        return vec![C64::new(0.0, 0.0); zero_roots];
    }

    // Balance the variable: with a monic polynomial the product of the roots is
    // |c0|, so |c0|^(1/order) is the geometric-mean root magnitude. Scaling by
    // it maps the roots close to the unit circle and tames the coefficient
    // dynamic range that otherwise breaks Durand-Kerner at high order.
    let scale = coefficients[0].abs().powf(1.0 / order as f64);
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let scaled: Vec<f64> = (0..=order)
        .map(|k| coefficients[k] * scale.powi(k as i32 - order as i32))
        .collect();

    let radius = 1.0 + scaled[..order]
        .iter()
        .map(|x| x.abs())
        .fold(0.0, f64::max);
    let seed = C64::from_polar(radius, 0.37);
    let mut roots: Vec<_> = (0..order)
        .map(|i| seed * C64::from_polar(1.0, 2.0 * PI * i as f64 / order as f64))
        .collect();
    for _ in 0..5000 {
        let previous = roots.clone();
        let mut max_change: f64 = 0.0;
        for i in 0..order {
            let denominator = previous.iter().enumerate()
                .filter(|(j, _)| *j != i)
                .fold(C64::new(1.0, 0.0), |value, (_, root)| {
                    let delta = previous[i] - root;
                    if delta.norm() < 1e-30 { value } else { value * delta }
                });
            if denominator.norm() < 1e-300 {
                continue;
            }
            let change = eval_complex_poly(&scaled, previous[i]) / denominator;
            if !change.is_finite() {
                continue;
            }
            roots[i] = previous[i] - change;
            max_change = max_change.max(change.norm());
        }
        if max_change < 2e-13 {
            break;
        }
    }

    let mut result: Vec<C64> = roots.into_iter().map(|root| root * scale).collect();
    result.extend(std::iter::repeat(C64::new(0.0, 0.0)).take(zero_roots));
    result
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn transforms_preserve_zpk_structure() {
        let prototype = Zpk {
            zeros: vec![],
            poles: vec![C64::new(-1.0, 0.0)],
            gain: 1.0,
        };
        let hp = lowpass_to_highpass(&prototype, 10.0);
        assert_eq!(hp.zeros, vec![C64::new(0.0, 0.0)]);
        assert!((hp.poles[0].re + 10.0).abs() < 1e-12);
        let bp = lowpass_to_bandpass(&prototype, 10.0, 2.0);
        assert_eq!(bp.poles.len(), 2);
        assert_eq!(bp.zeros.len(), 1);
        let br = lowpass_to_bandreject(&prototype, 10.0, 2.0);
        assert_eq!(br.poles.len(), 2);
        assert_eq!(br.zeros.len(), 2);
    }

    #[test]
    fn high_order_roots_with_large_magnitude_converge() {
        // Order-8 Butterworth denominator at wc ≈ 1 kHz: constant term ~wc^8 ~ 1e30.
        // Build ascending coeffs of ∏(s − p) via descending monic form, then reverse.
        let n = 8usize;
        let wc = 6283.0_f64;
        let analytic: Vec<C64> = (0..n)
            .map(|i| {
                let m = -((n as i32) + 1) + 2 + 2 * i as i32;
                -C64::from_polar(wc, PI * m as f64 / (2.0 * n as f64))
            })
            .collect();
        let mut descending = vec![C64::new(1.0, 0.0)];
        for pole in &analytic {
            let mut next = vec![C64::new(0.0, 0.0); descending.len() + 1];
            for (i, value) in descending.iter().enumerate() {
                next[i] += *value;
                next[i + 1] -= *value * *pole;
            }
            descending = next;
        }
        let ascending: Vec<f64> = descending.iter().rev().map(|c| c.re).collect();

        let roots = polynomial_roots(&ascending);
        assert_eq!(roots.len(), n);
        for pole in &analytic {
            let matched = roots.iter().any(|r| (r - pole).norm() <= 1e-6 * wc);
            assert!(matched, "missing recovered pole near {pole:?}");
        }
    }

    #[test]
    fn butterworth_order8_bode_ba_matches_zpk() {
        use crate::engine::{compute_bode, compute_bode_from_zpk, filter_design, DesignRequest, ScalarOrPair};
        let request = DesignRequest {
            filter_type: 0,
            approx_type: 0,
            N_min: 8,
            N_max: 8,
            ap_dB: 1.0,
            aa_dB: 40.0,
            gain: 1.0,
            denorm: 0.0,
            define_with: 0,
            wp: ScalarOrPair::Scalar(2.0 * PI * 1000.0),
            wa: ScalarOrPair::Scalar(2.0 * PI * 2000.0),
            w0: 0.0,
            bw: [0.0, 0.0],
            gamma: 5.0,
            tau0: 1.0,
            wrg: 0.0,
        };
        let design = filter_design(&request).expect("design");
        assert_eq!(design.N, 8);
        let ba = compute_bode(&design.num, &design.den, 10.0, 1e5, 200).expect("ba bode");
        let gain = design.num[0] / design.den[0];
        let zpk = compute_bode_from_zpk(&design.zeros, &design.poles, gain, 10.0, 1e5, 200)
            .expect("zpk bode");
        for i in 0..ba.magnitude.len() {
            let denom = zpk.magnitude[i].abs().max(1e-30);
            let rel = (ba.magnitude[i] - zpk.magnitude[i]).abs() / denom;
            assert!(rel < 1e-8, "mag mismatch at {i}: rel={rel}");
        }
    }
}
