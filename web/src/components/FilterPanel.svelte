<script>
  import { getWorkerApi }  from '../lib/worker-client.js'
  import { freqRangeFromParams } from '../lib/approx.js'
  import { filterParams, filterResult, bodeData, stages, comparisons, bodePoints, uiEnabled, engineStatus } from '../stores/app.js'
  import SciInput from './SciInput.svelte'

  // ── Constants ─────────────────────────────────────────────────────────────
  const FILTER_TYPES  = ['Low-pass', 'High-pass', 'Band-pass', 'Band-reject', 'Group Delay']
  const APPROX_TYPES  = ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Legendre', 'Bessel', 'Gauss']
  const HAS_RIPPLE    = new Set([1, 2, 3])
  const TWO_PI        = 2 * Math.PI

  // ── Form state ────────────────────────────────────────────────────────────
  let filterType  = 0
  let approxType  = 0
  let nMin = 1,   nMax = 10
  let apDb = 3,   aaDb = 40,  gainDb = 0
  let denorm      = 0     // 0–100 %

  // LP / HP
  let fpHz = 1000, faHz = 2000

  // BP / BR
  let defineWith = 1
  let f0Hz = 1000, bwpHz = 200, bwaHz = 600
  let fp1Hz = 800, fp2Hz = 1200, fa1Hz = 600, fa2Hz = 1500

  // Group Delay
  let tau0 = 1e-3, frgHz = 1000, gamma = 5

  // ── Derived ───────────────────────────────────────────────────────────────
  $: isBand     = filterType === 2 || filterType === 3
  $: isGD       = filterType === 4
  $: showRipple = HAS_RIPPLE.has(approxType)

  // ── Submit ────────────────────────────────────────────────────────────────
  let computing = false
  let errorMsg  = ''

  async function design() {
    computing = true
    errorMsg  = ''
    engineStatus.set('Computing…')
    try {
      const params = buildParams()
      const api    = getWorkerApi()
      const result = await api.filterDesign(params)
      if (result.error) { errorMsg = result.error.split('\n').at(-2) ?? result.error; return }
      stages.set([])
      comparisons.set([])
      filterParams.set(params)
      filterResult.set(result)
      const r = freqRangeFromParams(params)
      bodeData.set(await api.computeBode(result.num, result.den, r.min, r.max, $bodePoints))
      engineStatus.set('Ready')
    } catch (e) {
      errorMsg = e.message
      engineStatus.set('Ready')
    } finally { computing = false }
  }

  function buildParams() {
    const toRad = hz => hz * TWO_PI
    const base = {
      filter_type: filterType, approx_type: approxType,
      N_min: nMin, N_max: nMax,
      ap_dB: apDb, aa_dB: aaDb,
      gain: Math.pow(10, gainDb / 20),
      normalization: 'Passband',
      is_helper: false, helper_approx: [], helper_N: -1,
      define_with: defineWith, denorm,
      gamma, tau0,
    }
    if (isGD) return { ...base, wrg: toRad(frgHz), wp: 0, wa: 0, w0: 0, bw: [0,0] }
    if (!isBand) return { ...base, wp: toRad(fpHz), wa: toRad(faHz), w0: 0, bw:[0,0], wrg:0 }
    if (defineWith === 1) return {
      ...base,
      wp: [toRad(f0Hz - bwpHz/2), toRad(f0Hz + bwpHz/2)],
      wa: [toRad(f0Hz - bwaHz/2), toRad(f0Hz + bwaHz/2)],
      w0: toRad(f0Hz), bw: [toRad(bwpHz), toRad(bwaHz)], wrg: 0,
    }
    return {
      ...base,
      wp: [toRad(fp1Hz), toRad(fp2Hz)], wa: [toRad(fa1Hz), toRad(fa2Hz)],
      w0: toRad(Math.sqrt(fp1Hz * fp2Hz)),
      bw: [toRad(fp2Hz - fp1Hz), toRad(fa2Hz - fa1Hz)], wrg: 0,
    }
  }
</script>

<div class="fp">

  <div class="row">
    <span class="lbl">Type</span>
    <select class="ctl" bind:value={filterType}>
      {#each FILTER_TYPES as t, i}<option value={i}>{t}</option>{/each}
    </select>
  </div>

  <div class="row">
    <span class="lbl">Approx</span>
    <select class="ctl" bind:value={approxType}>
      {#each APPROX_TYPES as a, i}<option value={i}>{a}</option>{/each}
    </select>
  </div>

  <div class="row">
    <span class="lbl">N min</span>
    <input class="ctl num" type="number" min="1" max="50" bind:value={nMin} />
  </div>
  <div class="row">
    <span class="lbl">N max</span>
    <input class="ctl num" type="number" min="1" max="50" bind:value={nMax} />
  </div>

  <div class="rule"></div>

  {#if !isGD}
    {#if !isBand}
      <div class="row">
        <span class="lbl">fp</span>
        <SciInput bind:value={fpHz} unit="Hz" min={1e-3} max={1e12} />
      </div>
      <div class="row">
        <span class="lbl">fa</span>
        <SciInput bind:value={faHz} unit="Hz" min={1e-3} max={1e12} />
      </div>
    {:else}
      <div class="row">
        <span class="lbl">Define</span>
        <select class="ctl" bind:value={defineWith}>
          <option value={1}>f₀ + BW</option>
          <option value={0}>Frequencies</option>
        </select>
      </div>
      {#if defineWith === 1}
        <div class="row">
          <span class="lbl">f₀</span>
          <SciInput bind:value={f0Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
        <div class="row">
          <span class="lbl">BWp</span>
          <SciInput bind:value={bwpHz} unit="Hz" min={1e-6} max={1e12} />
        </div>
        <div class="row">
          <span class="lbl">BWa</span>
          <SciInput bind:value={bwaHz} unit="Hz" min={1e-6} max={1e12} />
        </div>
      {:else}
        <div class="row">
          <span class="lbl">fp₁</span>
          <SciInput bind:value={fp1Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
        <div class="row">
          <span class="lbl">fp₂</span>
          <SciInput bind:value={fp2Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
        <div class="row">
          <span class="lbl">fa₁</span>
          <SciInput bind:value={fa1Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
        <div class="row">
          <span class="lbl">fa₂</span>
          <SciInput bind:value={fa2Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
      {/if}
    {/if}

    <div class="rule"></div>

    {#if showRipple}
      <div class="row">
        <span class="lbl">Ripple</span>
        <SciInput bind:value={apDb} unit="dB" min={0.001} max={40} logNudge={false} step={0.5} />
      </div>
    {/if}
    <div class="row">
      <span class="lbl">Attenuation</span>
      <SciInput bind:value={aaDb} unit="dB" min={1} max={120} logNudge={false} step={1} />
    </div>

  {:else}
    <div class="row">
      <span class="lbl">τ₀</span>
      <SciInput bind:value={tau0} unit="s" min={1e-12} max={1} />
    </div>
    <div class="row">
      <span class="lbl">f ref</span>
      <SciInput bind:value={frgHz} unit="Hz" min={1e-3} max={1e12} />
    </div>
    <div class="row">
      <span class="lbl">γ</span>
      <div class="with-unit">
        <input class="ctl num" type="number" min="0.01" max="99" step="0.5" bind:value={gamma} />
        <span class="unit">%</span>
      </div>
    </div>
  {/if}

  <div class="rule"></div>

  <div class="row">
    <span class="lbl">Gain</span>
    <SciInput bind:value={gainDb} unit="dB" logNudge={false} step={1} />
  </div>

  <div class="row">
    <span class="lbl">Denorm</span>
    <div class="denorm">
      <input class="slider" type="range" min="0" max="100" step="1" bind:value={denorm} />
      <span class="pct">{denorm}%</span>
    </div>
  </div>

  {#if errorMsg}
    <p class="err">{errorMsg}</p>
  {/if}

  <button class="btn" disabled={!$uiEnabled || computing} on:click={design}>
    {computing ? 'Computing…' : 'Design Filter'}
  </button>

</div>

<style>
  .fp {
    --lbl-w: 5.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.5rem 0.7rem 0.75rem;
  }

  .row {
    display: grid;
    grid-template-columns: var(--lbl-w) minmax(0, 1fr);
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .lbl {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.2;
    white-space: nowrap;
    text-align: left;
  }

  .ctl {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.88rem;
    padding: 0.35rem 0.45rem;
    width: 100%;
    min-width: 0;
    outline: none;
  }
  .ctl:focus { border-color: var(--accent); }
  .ctl.num { font-family: ui-monospace, 'SF Mono', Consolas, monospace; }

  .with-unit {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .with-unit .ctl { flex: 1; }
  .unit {
    font-size: 0.8rem;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .denorm {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    height: 2rem;
  }
  .pct {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    min-width: 2.4rem;
    text-align: right;
  }

  /* Tall hit-box so the thumb isn't clipped by a 5px element height */
  .slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 2rem;
    margin: 0;
    background: transparent;
    outline: none;
    cursor: pointer;
  }
  .slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: var(--border);
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }
  .slider::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: var(--border);
  }
  .slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }

  .rule {
    height: 1px;
    background: var(--surface-2);
    margin: 0.15rem 0;
  }

  .btn {
    background: var(--accent-strong);
    border: none;
    border-radius: 4px;
    color: #fff;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.5rem;
    width: 100%;
    margin-top: 0.15rem;
  }
  .btn:hover:not(:disabled) { background: var(--accent-hover); }
  .btn:disabled { background: var(--surface-2); color: var(--disabled); cursor: default; }

  .err {
    font-size: 0.82rem;
    color: var(--danger);
    background: var(--danger-bg);
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    word-break: break-word;
    overflow-wrap: anywhere;
    margin: 0;
    max-height: 6rem;
    overflow-y: auto;
  }
</style>
