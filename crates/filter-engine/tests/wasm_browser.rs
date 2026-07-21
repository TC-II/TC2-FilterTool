#![cfg(target_arch = "wasm32")]

use filter_engine::{
    build_stage, compute_bode, filter_design, DesignRequest, ScalarOrPair,
};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn low_pass() -> DesignRequest {
    DesignRequest {
        filter_type: 0,
        approx_type: 0,
        N_min: 1,
        N_max: 10,
        ap_dB: 1.0,
        aa_dB: 30.0,
        gain: 1.0,
        denorm: 0.0,
        define_with: 1,
        wp: ScalarOrPair::Scalar(2.0 * std::f64::consts::PI * 1000.0),
        wa: ScalarOrPair::Scalar(2.0 * std::f64::consts::PI * 2000.0),
        w0: 0.0,
        bw: [0.0, 0.0],
        gamma: 5.0,
        tau0: 0.001,
        wrg: 0.0,
    }
}

#[wasm_bindgen_test]
fn filter_bode_and_stage_execute_in_browser() {
    let design = filter_design(&low_pass()).unwrap();
    assert_eq!(design.N, 6);
    let bode = compute_bode(&design.num, &design.den, 10.0, 100_000.0, 97).unwrap();
    assert_eq!(bode.freq.len(), 97);
    assert!(bode.magnitude.iter().all(|value| value.is_finite()));
    let stage = build_stage(
        &[],
        &[[-100.0, 994.98743710662], [-100.0, -994.98743710662]],
        1.5,
        "Passband",
        0,
    ).unwrap();
    assert!((stage.gain - 1_500_000.0).abs() < 1e-6);
}
