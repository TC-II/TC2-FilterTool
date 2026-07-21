use filter_engine::{
    bessel_delay_prototype, cauer_order, gauss_prototype, legendre_prototype,
    lowpass_to_bandpass, lowpass_to_bandreject, lowpass_to_highpass,
    select_group_delay_order, C64, Zpk,
};
use serde_json::Value;

const GOLDEN: &str =
    include_str!("../../../web/engine-fixtures/pyodide-golden.json");

fn fixtures() -> Value {
    serde_json::from_str(GOLDEN).expect("golden fixture JSON must parse")
}

fn design<'a>(root: &'a Value, id: &str) -> &'a Value {
    root["designs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == id)
        .unwrap_or_else(|| panic!("missing design fixture {id}"))
}

fn expected_zpk(case: &Value) -> Zpk {
    let value = &case["outcome"]["value"];
    let pairs = |name: &str| {
        value[name]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| C64::new(pair[0].as_f64().unwrap(), pair[1].as_f64().unwrap()))
            .collect()
    };
    Zpk {
        zeros: pairs("zeros"),
        poles: pairs("poles"),
        gain: value["gain"].as_f64().unwrap(),
    }
}

fn assert_unordered_close(actual: &[C64], expected: &[C64], abs: f64, rel: f64) {
    assert_eq!(actual.len(), expected.len());
    let mut unused = expected.to_vec();
    for value in actual {
        let (index, error) = unused
            .iter()
            .enumerate()
            .map(|(i, expected)| {
                let scale = value.norm().max(expected.norm());
                (i, (*value - *expected).norm() / (abs + rel * scale))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        assert!(error <= 1.0, "{value:?} differs from fixture; normalized error={error}");
        unused.remove(index);
    }
}

fn normalize_shape(poles: &[C64]) -> Vec<C64> {
    let scale = poles.iter().map(|p| p.norm().ln()).sum::<f64>() / poles.len() as f64;
    let scale = scale.exp();
    poles.iter().map(|p| p / scale).collect()
}

#[test]
fn fixture_loader_exposes_validity_and_exact_order() {
    let root = fixtures();
    for id in [
        "lp-cauer",
        "lp-legendre",
        "lp-bessel",
        "lp-gauss",
        "gd-bessel",
        "gd-gauss",
        "bp-cauer-f0-bw",
        "bp-legendre-template-frequencies",
        "br-cheby2-template-frequencies",
    ] {
        let case = design(&root, id);
        assert_eq!(case["outcome"]["ok"], true, "{id} unexpectedly invalid");
        assert!(case["outcome"]["value"]["N"].as_u64().unwrap() > 0);
    }
    for id in [
        "invalid-order-min",
        "invalid-order-max",
        "invalid-lp-frequency-order",
        "invalid-band-frequency-order",
        "invalid-group-delay-gamma",
    ] {
        assert_eq!(design(&root, id)["outcome"]["ok"], false);
    }
}

#[test]
fn cauer_order_matches_oracle_decisions() {
    let root = fixtures();
    for id in ["lp-cauer", "bp-cauer-f0-bw", "high-order-cauer-12"] {
        let case = design(&root, id);
        let request = &case["request"];
        let natural = cauer_order(
            1.0,
            if request["filter_type"] == 2 {
                request["bw"][1].as_f64().unwrap() / request["bw"][0].as_f64().unwrap()
            } else {
                request["wa"].as_f64().unwrap() / request["wp"].as_f64().unwrap()
            },
            request["ap_dB"].as_f64().unwrap(),
            request["aa_dB"].as_f64().unwrap(),
        );
        let selected = natural
            .max(request["N_min"].as_u64().unwrap() as usize)
            .min(request["N_max"].as_u64().unwrap() as usize);
        assert_eq!(selected, case["outcome"]["value"]["N"].as_u64().unwrap() as usize);
    }
}

#[test]
fn custom_legendre_and_gauss_match_fixture_pole_shapes() {
    let root = fixtures();
    let legendre_case = design(&root, "lp-legendre");
    let legendre_order = legendre_case["outcome"]["value"]["N"].as_u64().unwrap() as usize;
    let epsilon = (10_f64.powf(0.1) - 1.0).sqrt();
    let actual = normalize_shape(&legendre_prototype(legendre_order, epsilon).poles);
    let expected = normalize_shape(&expected_zpk(legendre_case).poles);
    assert_unordered_close(&actual, &expected, 2e-7, 2e-6);

    let gauss_case = design(&root, "lp-gauss");
    let gauss_order = gauss_case["outcome"]["value"]["N"].as_u64().unwrap() as usize;
    let actual = normalize_shape(&gauss_prototype(gauss_order).poles);
    let expected = normalize_shape(&expected_zpk(gauss_case).poles);
    assert_unordered_close(&actual, &expected, 2e-7, 2e-6);
}

#[test]
fn bessel_and_gauss_group_delay_selection_match_zpk_fixtures() {
    let root = fixtures();
    let omega_n = 2.0 * std::f64::consts::PI * 100.0 * 0.001;
    let (bessel_n, bessel) =
        select_group_delay_order(1, 10, omega_n, 0.05, bessel_delay_prototype);
    let expected = design(&root, "gd-bessel");
    assert_eq!(bessel_n, expected["outcome"]["value"]["N"].as_u64().unwrap() as usize);
    let bessel = filter_engine::scale_frequency(&bessel, 1000.0);
    assert_unordered_close(&bessel.poles, &expected_zpk(expected).poles, 1e-7, 1e-8);

    let (gauss_n, gauss) =
        select_group_delay_order(1, 10, omega_n, 0.05, gauss_prototype);
    let expected = design(&root, "gd-gauss");
    assert_eq!(gauss_n, expected["outcome"]["value"]["N"].as_u64().unwrap() as usize);
    let gauss = filter_engine::scale_frequency(&gauss, 1000.0);
    assert_unordered_close(&gauss.poles, &expected_zpk(expected).poles, 2e-6, 2e-8);
}

#[test]
fn fixture_zpk_satisfies_hp_bp_br_transform_invariants() {
    let root = fixtures();

    // Oracle HP designs place an origin zero for every pole.
    let hp_case = design(&root, "hp-butterworth");
    let hp = expected_zpk(hp_case);
    let n = hp_case["outcome"]["value"]["N"].as_u64().unwrap() as usize;
    assert_eq!(hp.poles.len(), n);
    assert_eq!(hp.zeros.len(), n);
    assert!(hp.zeros.iter().all(|z| z.norm() < 1e-9));

    let wp = 12_566.370_614_359_172;
    let unit = Zpk {
        zeros: vec![],
        poles: vec![C64::new(-1.0, 0.0)],
        gain: 1.0,
    };
    let hp1 = lowpass_to_highpass(&unit, wp);
    assert_eq!(hp1.zeros, vec![C64::new(0.0, 0.0)]);
    assert!((hp1.poles[0] + C64::new(wp, 0.0)).norm() < 1e-8);

    let bp = expected_zpk(design(&root, "bp-cauer-f0-bw"));
    assert_quadratic_pair_products(&bp.poles, 6_283.185_307_179_586);
    let br = expected_zpk(design(&root, "br-cheby2-template-frequencies"));
    assert_quadratic_pair_products(&br.poles, 6_156.239_184_776_948);

    // Direct first-order checks cover the project-owned gain and added-zero
    // conventions, independently of SciPy's prototype implementation.
    let bp1 = lowpass_to_bandpass(&unit, 10.0, 2.0);
    assert!((bp1.poles[0] * bp1.poles[1] - C64::new(100.0, 0.0)).norm() < 1e-10);
    assert_eq!(bp1.zeros, vec![C64::new(0.0, 0.0)]);
    let br1 = lowpass_to_bandreject(&unit, 10.0, 2.0);
    assert!((br1.poles[0] * br1.poles[1] - C64::new(100.0, 0.0)).norm() < 1e-10);
    assert_eq!(br1.zeros.len(), 2);
}

fn assert_quadratic_pair_products(poles: &[C64], omega0: f64) {
    let mut unused = poles.to_vec();
    while let Some(first) = unused.pop() {
        let (index, _) = unused
            .iter()
            .enumerate()
            .map(|(i, other)| (i, (first * *other - C64::new(omega0 * omega0, 0.0)).norm()))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        let second = unused.remove(index);
        let relative = (first * second - C64::new(omega0 * omega0, 0.0)).norm()
            / (omega0 * omega0);
        assert!(relative < 2e-8, "transform pair product relative error={relative}");
    }
}
