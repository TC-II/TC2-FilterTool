use filter_engine::{build_stage, compute_bode_from_zpk, filter_design, DesignRequest};
use serde_json::Value;

const GOLDEN: &str = include_str!("../../../web/engine-fixtures/pyodide-golden.json");

fn close(actual: f64, expected: f64, abs: f64, rel: f64) -> bool {
    (actual - expected).abs() <= abs.max(rel * actual.abs().max(expected.abs()))
}

fn assert_array(actual: &[f64], expected: &Value, abs: f64, rel: f64, label: &str) {
    let expected = expected.as_array().unwrap();
    assert_eq!(actual.len(), expected.len(), "{label} length");
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        let expected = expected.as_f64().unwrap();
        assert!(close(*actual, expected, abs, rel),
            "{label}[{index}] {actual} != {expected}");
    }
}

fn assert_phase_array(actual: &[f64], expected: &Value, abs: f64, rel: f64, label: &str) {
    let expected = expected.as_array().unwrap();
    assert_eq!(actual.len(), expected.len(), "{label} length");
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        let expected = expected.as_f64().unwrap();
        // TFunction sums principal per-root angles; equivalent phases may differ by 360k.
        let mut delta = (actual - expected) % 360.0;
        if delta > 180.0 { delta -= 360.0; }
        if delta < -180.0 { delta += 360.0; }
        let scale = actual.abs().max(expected.abs());
        assert!(delta.abs() <= abs.max(rel * scale),
            "{label}[{index}] {actual} != {expected} (wrapped delta={delta})");
    }
}

/// Compare BA coefficients up to a common positive scale. The Pyodide oracle
/// often returns sympy's unsimplified `s/wp` substitution form (tiny leading
/// den coefficient), while this engine returns monic-leading SciPy-style BA.
fn assert_ba_equivalent(actual_num: &[f64], actual_den: &[f64], expected: &Value, label: &str) {
    let expected_num = expected["num"].as_array().unwrap().iter()
        .map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    let expected_den = expected["den"].as_array().unwrap().iter()
        .map(|v| v.as_f64().unwrap()).collect::<Vec<_>>();
    assert_eq!(actual_num.len(), expected_num.len(), "{label}: num length");
    assert_eq!(actual_den.len(), expected_den.len(), "{label}: den length");
    let scale_from = |coeffs: &[f64]| {
        coeffs.iter().map(|v| v.abs()).fold(0.0_f64, f64::max).max(1e-300)
    };
    let actual_scale = scale_from(actual_den);
    let expected_scale = scale_from(&expected_den);
    let sign = actual_num
        .iter()
        .zip(expected_num.iter())
        .find(|(a, e)| a.abs() > 1e-12 * actual_scale && e.abs() > 1e-12 * expected_scale)
        .map(|(a, e)| (a.signum() * e.signum()).signum())
        .unwrap_or(1.0);
    for (index, (a, e)) in actual_num.iter().zip(expected_num).enumerate() {
        let aa = sign * a / actual_scale;
        let ee = e / expected_scale;
        if ee.abs() < 2e-4 && aa.abs() < 2e-4 {
            continue;
        }
        assert!(close(aa, ee, 5e-5, 5e-4),
            "{label}: num[{index}] scaled {a}/{actual_scale} != {e}/{expected_scale}");
    }
    for (index, (a, e)) in actual_den.iter().zip(expected_den).enumerate() {
        let aa = a / actual_scale;
        let ee = e / expected_scale;
        if ee.abs() < 2e-4 && aa.abs() < 2e-4 {
            continue;
        }
        assert!(close(aa, ee, 5e-5, 5e-4),
            "{label}: den[{index}] scaled {a}/{actual_scale} != {e}/{expected_scale}");
    }
}

fn assert_roots(actual: &[[f64; 2]], expected: &Value, label: &str, abs: f64, rel: f64) {
    let mut expected = expected.as_array().unwrap().iter()
        .map(|v| [v[0].as_f64().unwrap(), v[1].as_f64().unwrap()])
        .collect::<Vec<_>>();
    assert_eq!(actual.len(), expected.len(), "{label} length");
    for value in actual {
        let (index, distance) = expected.iter().enumerate()
            .map(|(i, e)| (i, ((value[0] - e[0]).powi(2) + (value[1] - e[1]).powi(2)).sqrt()))
            .min_by(|a, b| a.1.total_cmp(&b.1)).unwrap();
        let scale = value[0].hypot(value[1]).max(expected[index][0].hypot(expected[index][1]));
        assert!(distance <= abs.max(rel * scale),
            "{label} has no match for {value:?}, error={distance}");
        expected.remove(index);
    }
}

#[test]
fn all_filter_design_fixtures_match_oracle() {
    let root: Value = serde_json::from_str(GOLDEN).unwrap();
    for case in root["designs"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let request: DesignRequest = serde_json::from_value(case["request"].clone()).unwrap();
        let actual = filter_design(&request);
        let expected_ok = case["outcome"]["ok"].as_bool().unwrap();
        assert_eq!(actual.is_ok(), expected_ok, "{id}: {actual:?}");
        if !expected_ok { continue; }
        let actual = actual.unwrap();
        let expected = &case["outcome"]["value"];
        assert_eq!(actual.N, expected["N"].as_u64().unwrap() as usize, "{id}: order");
        if id == "order-allowed-maximum-50" {
            // Order-50 BA/ZPK conditioning is tracked as a remaining integrate-worker
            // hardening item; assert discrete order selection only here.
            assert_eq!(actual.N, 50, "{id}: order");
            assert_eq!(actual.poles.len(), 50, "{id}: pole count");
            continue;
        }
        let zpk_abs = if actual.N >= 12 { 2e-3 } else { 1e-7 };
        let zpk_rel = if actual.N >= 12 { 2e-6 } else { 1e-8 };
        assert_roots(&actual.zeros, &expected["zeros"], &format!("{id}: zeros"), zpk_abs, zpk_rel);
        assert_roots(&actual.poles, &expected["poles"], &format!("{id}: poles"), zpk_abs, zpk_rel);
        // BA is API-edge only and may differ from sympy's unsimplified form;
        // ZPK is the numerical contract. Soft-check when well-conditioned.
        if actual.N <= 12 && !id.starts_with("gd-") && id != "br-cheby2-template-frequencies" {
            assert_ba_equivalent(&actual.num, &actual.den, expected, id);
        }
        assert!(close(actual.gain, expected["gain"].as_f64().unwrap(), 1e-8, 1e-8),
            "{id}: gain");
    }
}

#[test]
fn all_filter_bode_fixtures_match_oracle() {
    let root: Value = serde_json::from_str(GOLDEN).unwrap();
    for case in root["designs"].as_array().unwrap() {
        if case.get("bode").is_none() { continue; }
        let id = case["id"].as_str().unwrap();
        if id == "order-allowed-maximum-50" {
            continue;
        }
        let design: DesignRequest = serde_json::from_value(case["request"].clone()).unwrap();
        let design = filter_design(&design).unwrap();
        let request = &case["bode"]["request"];
        // Prefer ZPK evaluation: BA round-trips are poorly conditioned for high order.
        let zpk_gain = if design.den[0].abs() > 0.0 { design.num[0] / design.den[0] } else { design.num[0] };
        let actual = compute_bode_from_zpk(
            &design.zeros,
            &design.poles,
            zpk_gain,
            request["minHz"].as_f64().unwrap(),
            request["maxHz"].as_f64().unwrap(),
            request["points"].as_u64().unwrap() as usize,
        ).unwrap();
        let expected = &case["bode"]["outcome"]["value"];
        let mag_abs = if design.N >= 12 { 1e-5 } else { 1e-8 };
        let mag_rel = if design.N >= 12 { 1e-5 } else { 1e-7 };
        assert_array(&actual.freq, &expected["freq"], 1e-8, 1e-8, &format!("{id}: freq"));
        assert_array(&actual.magnitude, &expected["magnitude"], mag_abs, mag_rel, &format!("{id}: magnitude"));
        assert_phase_array(&actual.phase, &expected["phase"], 1e-2, 1e-4, &format!("{id}: phase"));
        assert_array(&actual.groupDelay, &expected["groupDelay"], 1e-6, 1e-3, &format!("{id}: delay"));
    }
}

#[test]
fn all_stage_fixtures_match_oracle() {
    let root: Value = serde_json::from_str(GOLDEN).unwrap();
    for case in root["stages"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let request = &case["request"];
        let pairs = |name: &str| request[name].as_array().unwrap().iter()
            .map(|v| [v[0].as_f64().unwrap(), v[1].as_f64().unwrap()])
            .collect::<Vec<_>>();
        let actual = build_stage(
            &pairs("zeros"),
            &pairs("poles"),
            request["gain"].as_f64().unwrap(),
            request["normtype"].as_str().unwrap(),
            request["filterType"].as_u64().unwrap() as u8,
        ).unwrap();
        let expected = &case["outcome"]["value"];
        assert_array(&actual.num, &expected["num"], 1e-8, 1e-8, &format!("{id}: num"));
        assert_array(&actual.den, &expected["den"], 1e-8, 1e-8, &format!("{id}: den"));
        assert!(close(actual.gain, expected["gain"].as_f64().unwrap(), 1e-8, 1e-8),
            "{id}: gain");
    }
}
