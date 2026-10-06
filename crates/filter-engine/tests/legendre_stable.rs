//! Optimum L (Legendre) prototypes stay accurate up to the engine's maximum
//! order: the old power-basis root finding broke down past order ~16.
use filter_engine::{legendre_leps, legendre_magnitude_sq, legendre_prototype, polynomial_roots, C64, Zpk};

fn mag_sq(zpk: &Zpk, w: f64) -> f64 {
    let s = C64::new(0.0, w);
    // Log form so order-50 products stay finite
    let mut log = zpk.gain.abs().ln();
    for p in &zpk.poles { log -= (s - p).norm().ln(); }
    for z in &zpk.zeros { log += (s - z).norm().ln(); }
    (2.0 * log).exp()
}

fn eps(ap_db: f64) -> f64 { (10_f64.powf(ap_db / 10.0) - 1.0).sqrt() }

#[test]
fn matches_power_basis_poles_at_low_order() {
    for ap in [0.5, 1.0, 3.0, 11.183] {
        let e = eps(ap);
        for n in 1..=10 {
            let new = legendre_prototype(n, e).poles;
            let old: Vec<C64> = polynomial_roots(&legendre_leps(n, e))
                .into_iter()
                .map(|r| r * C64::new(0.0, -1.0))
                .filter(|r| r.re <= 1e-8)
                .collect();
            assert_eq!(new.len(), n, "order {n}");
            assert_eq!(old.len(), n, "order {n}");
            for p in &new {
                let d = old.iter().map(|q| (p - q).norm()).fold(f64::INFINITY, f64::min);
                assert!(d < 1e-7 * p.norm().max(1.0), "ap {ap} order {n}: pole {p} off by {d}");
            }
        }
    }
}

#[test]
fn accurate_up_to_order_50() {
    for ap in [0.5, 3.0, 11.183] {
        let e = eps(ap);
        for n in 1..=50 {
            let zpk = legendre_prototype(n, e);
            assert_eq!(zpk.poles.len(), n);
            assert!(zpk.poles.iter().all(|p| p.is_finite() && p.re < 0.0), "ap {ap} order {n}: unstable / NaN poles");
            // DC gain 1, passband edge at -ap dB, and the closed form everywhere else
            assert!((mag_sq(&zpk, 0.0) - 1.0).abs() < 1e-9, "ap {ap} order {n}: DC");
            for w in [0.3, 0.8, 1.0, 1.2, 2.0, 5.0] {
                let got = mag_sq(&zpk, w);
                let want = legendre_magnitude_sq(n, e, w);
                assert!((got.ln() - want.ln()).abs() < 1e-6, "ap {ap} order {n} w {w}: {got} vs {want}");
            }
            let edge = 10.0 * mag_sq(&zpk, 1.0).log10();
            assert!((edge + ap).abs() < 1e-6, "ap {ap} order {n}: |H(j1)| = {edge} dB");
        }
    }
}
