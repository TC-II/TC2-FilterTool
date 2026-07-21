# filter-engine

Rust/WASM numerical core for TC2 analog filter design. This crate implements
the browser worker contract:

- `filterDesign`
- `computeBode`
- `buildStageFromZPK`

Dataset parsing (`parseDataset`) is **out of scope** here. The web app uses
this engine exclusively; the former Pyodide runtime was removed at cutover.

## API surface

Native Rust:

- `filter_design(&DesignRequest) -> Result<DesignResponse, String>`
- `compute_bode(num, den, min_hz, max_hz, points) -> Result<BodeResponse, String>`
- `compute_bode_from_zpk(zeros, poles, gain, ...)` for high-order-stable evaluation
- `build_stage(zeros, poles, gain, norm, filter_type) -> Result<StageResponse, String>`

WASM (`wasm-bindgen`, camelCase):

- `filterDesign(requestJsonLikeObject)`
- `computeBode(num, den, freqMinHz?, freqMaxHz?, numPoints?)`
- `buildStageFromZPK(zeros, poles, gain, normtype?, filterType?)`
- `risk_spike_capabilities()` diagnostic string

Response shapes match `web/src/lib/engine-api.ts`. Invalid `filterDesign`
inputs return `{ error: string }` (value, not a thrown exception), matching
the Pyodide worker.

Internal representation is ZPK-first. BA (`num`/`den`) is produced only at
the API edge (monic-leading SciPy-style). Bode magnitude/phase/group-delay
prefer ZPK evaluation so high-order designs stay finite.

## Test commands (Windows / PowerShell)

From the repository root with MSVC `vcvars64` available:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
cmd /c "call `"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`" && cargo +stable-x86_64-pc-windows-msvc test --manifest-path crates\filter-engine\Cargo.toml --tests"
```

Results on this machine (port-core):

- unit + golden spike tests: **pass**
- `port_core` design / bode / stage golden parity: **pass**
  - design: order, zeros/poles (unordered), gain vs `web/engine-fixtures/pyodide-golden.json`
  - bode: magnitude / phase (mod 360°) / group delay from ZPK
  - stages: all normalization modes
  - `order-allowed-maximum-50`: order/pole-count only (full ZPK/bode hardening deferred)

Browser WASM test scaffold: `tests/wasm_browser.rs` (requires
`wasm-bindgen-test` + a browser runner; not executed in the native suite).

## Build WASM artifact

```powershell
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-msvc
cmd /c "call `"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`" && cargo +stable-x86_64-pc-windows-msvc build --release --target wasm32-unknown-unknown --manifest-path crates\filter-engine\Cargo.toml"
```

Raw `cdylib` output (Cargo target dir; may be under a sandbox cache path):

- `.../wasm32-unknown-unknown/release/filter_engine.wasm` (~625 KiB before bindgen)

Generate JS glue into the crate package dir:

```powershell
wasm-bindgen --target web --out-dir crates/filter-engine/pkg `
  path\to\filter_engine.wasm
```

Checked-in / regenerated package layout (this repo):

- `crates/filter-engine/pkg/filter_engine.js`
- `crates/filter-engine/pkg/filter_engine_bg.wasm` (~222 KiB after wasm-bindgen)
- `crates/filter-engine/pkg/filter_engine.d.ts`

The Vite app aliases this package as `@filter-engine`.

Example worker-side load:

```js
import init, {
  filterDesign,
  computeBode,
  buildStageFromZPK,
} from '../wasm/filter-engine/filter_engine.js'

await init()
const design = filterDesign(params) // object in / object or {error} out
const bode = computeBode(design.num, design.den, 0.1, 1e5, 2000)
const stage = buildStageFromZPK(zeros, poles, gain, 'Passband', 0)
```

## Implemented in port-core

- Full `filterDesign` path: Butterworth, Chebyshev I/II, Cauer/elliptic,
  Legendre, Bessel, Gauss; LP/HP/BP/BR/GD; order clamp; validation errors
- Cauer/elliptic prototype (nomes + Jacobi), not only order
- Filter.py-compatible log-spaced Bode crossing search for denormalization %
  and Bessel/Gauss amplitude-mode selection
- Bode: magnitude, TFunction-style principal per-root phase, analytic group delay
- Stage extraction / `buildStageFromZPK` norm modes. `ω→ω0` evaluates
  `H(j·|p₀|)` to match desktop `Filter.addStage` / SciPy `freqresp`.
- Native golden tests against filter fixtures (not datasets)

## Remaining numerical hardening

- Harden order-50 ZPK/bode absolute parity (currently order/count only)
- Tighten BR / GD BA coefficient parity vs sympy’s unsimplified forms (ZPK is
  the contract; BA is API-edge)
- Optional: shrink WASM (LTO already on; consider lighter JS bridging than
  full serde maps)
- Browser `wasm-bindgen-test` CI job
- Dataset parsing remains out of scope for the web cutover

## Crate policy

Keep project-owned math. Do **not** pull `scirs2-signal`. The
`PrototypeProvider` trait remains the only external-prototype boundary.
