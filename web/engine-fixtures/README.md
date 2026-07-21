# Engine golden fixtures

`pyodide-golden.json` freezes the behavior of the former Pyodide worker. It is
the historical compatibility oracle for the Rust/WASM engine, not a
hand-authored statement of ideal DSP behavior.

The corpus covers every filter type and approximation, order clamps and the
allowed order-50 boundary, denormalization at 0/50/100%, both band-definition
paths, all stage normalization modes, invalid requests, high-order designs,
near-boundary designs, Bode responses, CSV parsing, and LTspice text parsing.

## Validate

From `web/` on Windows:

```powershell
npm install
npm run fixtures:test
```

The runtime oracle generator was deliberately removed with Pyodide. Preserve
the checked-in corpus as an immutable migration baseline. Rust golden tests in
`crates/filter-engine/tests/` execute the current engine against its filter
cases.

## Comparing a replacement engine

`assertions.js` is intentionally test-runner agnostic. It requires exact
request validity and selected order, compares poles and zeros as unordered
multisets, and applies the tolerances recorded in the fixture to coefficients,
magnitude, phase, and group delay. `schema.json` describes the fixture
envelope; `fixtures.test.mjs` also enforces required coverage.

An invalid `filterDesign` currently resolves to `{ "error": "..." }`.
Worker/runtime failures from the other methods reject their Comlink promises.
The fixture envelope records both as `ok: false` and retains `delivery` so a
later phase can deliberately normalize runtime behavior without ambiguity.
