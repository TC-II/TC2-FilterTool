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

## Game mode

The **GAME** button in the header opens a quiz ("name that filter") for the
main approximations (Butterworth, Chebyshev I / II, Cauer, Legendre) in LP /
HP / BP / BR form. Each round designs a random normalized filter with the WASM
engine and shows one view of it (magnitude, phase, pole-zero map, step or
group delay). Four round kinds, mixed at random (toggle them in Options):

- **Multiple choice**: 2 questions that view can answer (approximation,
  filter type, order, LP-prototype order for BP/BR, where |H| ripples, step
  initial / final values y(0⁺) = H(∞), y(∞) = H(0)).
- **Match the plot**: given one view of a filter, pick every card (of 4) that
  shows the same filter. Cards mix plot kinds (e.g. given the pole-zero map: 2
  phases + 2 magnitudes, or 2 phases, 1 magnitude and 1 step) and 1–4 of them
  are correct (multi-select; a correct card never repeats a view). Magnitude /
  phase / pole-zero pair freely; the step response only pairs with magnitude or
  pole-zero; the group delay only appears as a card. At least 2 cards share the
  filter type, and distractor orders stay within ±1 (±2 for Chebyshev / Cauer,
  whose parity shows).
- **Line-up**: one template designed with 3–4 of the enabled approximations,
  each at its minimum order, overlaid on one magnitude, phase or pole-zero plot
  (slot colours A–D, never tied to the approximation); name each curve. Needs
  at least 3 approximations enabled. Orders are capped (LP/HP 10, band
  prototype 7) and Legendre needs order ≥ 3, otherwise the template is redrawn.
- **Theory cards**: a plot-less flash card from TC2 Guía 3 (ej. 3.43, 3.25,
  3.12), multi-select: "which approximations have property X?" or "which of
  these hold for approximation Y?". Bessel joins the cards that mention it.
  Card data and answer keys: `src/lib/game/theory.js`.

Saved settings carry a version (`v`): saves from before a round kind existed
get it switched on once.

Answers only list the approximations and types enabled in Options. **EXIT**
returns to the designer, whose state is kept.
The 🍔/🧉 switch in the game header changes the language (English or Spanish).

- Logic: `src/lib/game/quiz.js` and `src/lib/game/theory.js` (pure; run under node against the engine)
- UI: `src/components/game/GameMode.svelte`, `GamePlot.svelte`
- Enter / exit show: `src/lib/game/transition.js` (pixel curtain, splash, mascot)
- Mascot and sounds are ported from
  [TC-II/neandertool](https://github.com/TC-II/neandertool): `src/lib/game/mascot.js`
  with the sprites in `public/game/mascot/` (regenerate them with neandertool's
  `tools/mascot`), and `src/lib/game/sfx.js`.
