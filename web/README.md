# FilterTool web app

The browser app uses the Rust/WebAssembly filter engine exclusively. It has no
Python runtime, package CDN, or engine-selection flag. The worker API covers
filter design, Bode response calculation, and stage construction; dataset
parsing is outside the web cutover scope.

## Build and test

From `web/`:

```powershell
npm install
npm run fixtures:test
npm run build
```

The checked-in golden corpus was captured from the former Pyodide engine.
Native Rust tests execute the current implementation against those fixtures:

```powershell
cargo test --manifest-path ..\crates\filter-engine\Cargo.toml --tests
```

On Windows with MSVC, prefer:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
cmd /c "call `"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`" && cargo +stable-x86_64-pc-windows-msvc test --manifest-path crates\filter-engine\Cargo.toml --tests"
```

CI runs these same gates from `.github/workflows/filter-engine.yml`.

## GitHub Pages

`vite.config.js` sets `base: '/TC2-FilterTool/'` for project Pages at
`https://<owner>.github.io/TC2-FilterTool/`.

Deploy is automated by `.github/workflows/pages.yml` on pushes to `main` /
`master` (and via **Actions → Deploy Pages → Run workflow**).

One-time setup in the GitHub repo:

1. **Settings → Pages → Source:** GitHub Actions
2. Push to the default branch (or run the workflow manually)
3. Open the Pages URL shown on the workflow run

If the repository is renamed, update `base` in `vite.config.js` to match
`/<repo-name>/`.

## Payload and startup

Production builds emit `filter_engine_bg-*.wasm` at about **222 KiB**
(~71 KiB gzip). The removed Pyodide path downloaded a multi-megabyte Python
runtime plus NumPy, SciPy, SymPy, and micropip (typically tens of megabytes
before browser caching). Startup now fetches and instantiates one small WASM
module instead of booting Python and loading packages, so a cold start should
move from network/package initialization measured in seconds to a sub-second
WASM fetch and initialization on typical broadband hardware. Exact timings
remain device- and cache-dependent.

## Rebuilding the WASM package

From the repository root in PowerShell:

```powershell
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-msvc
cmd /c "call `"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat`" && cargo +stable-x86_64-pc-windows-msvc build --release --target wasm32-unknown-unknown --manifest-path crates\filter-engine\Cargo.toml"
wasm-bindgen --target web --out-dir crates/filter-engine/pkg `
  path\to\wasm32-unknown-unknown\release\filter_engine.wasm
```

No copy step is needed: `web/vite.config.js` aliases `@filter-engine` to the
crate's generated `pkg/` directory. Vite emits its JS/WASM assets for the ES
module worker during `npm run build`.
