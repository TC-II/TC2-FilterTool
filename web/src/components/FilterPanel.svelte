<script>
  import { getWorkerApi }  from '../lib/worker-client.js'
  import { filterParams, filterResult, bodeData, stages, comparisons, bodePoints, uiEnabled, pyodideStatus } from '../stores/app.js'
  import SciInput from './SciInput.svelte'

  // ── Constants ─────────────────────────────────────────────────────────────
  const FILTER_TYPES  = ['Low-pass', 'High-pass', 'Band-pass', 'Band-reject', 'Group Delay']
  const APPROX_TYPES  = ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Legendre', 'Bessel', 'Gauss']
  const POINTS_OPTIONS = [100, 500, 1000, 2000, 5000, 10000]
  const HAS_RIPPLE    = new Set([1, 2, 3])
  const TWO_PI        = 2 * Math.PI

  // ── Form state ────────────────────────────────────────────────────────────
  let filterType  = 0
  let approxType  = 0
  let nMin = 1,   nMax = 10
  let apDb = 3,   aaDb = 40,  gainDb = 0
  let filterName  = ''
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
    pyodideStatus.set('Computing…')
    try {
      const params = buildParams()
      const api    = getWorkerApi()
      const result = await api.filterDesign(params)
      if (result.error) { errorMsg = result.error.split('\n').at(-2) ?? result.error; return }
      stages.set([])
      comparisons.set([])
      filterParams.set(params)
      filterResult.set(result)
      const r = getFreqRange()
      bodeData.set(await api.computeBode(result.num, result.den, r.min, r.max, $bodePoints))
      pyodideStatus.set('Ready')
    } catch (e) {
      errorMsg = e.message
      pyodideStatus.set('Ready')
    } finally { computing = false }
  }

  // Re-run only the Bode computation when points change (no redesign needed).
  async function onPointsChange() {
    if (!$filterResult) return
    try {
      const r = getFreqRange()
      const api = getWorkerApi()
      bodeData.set(await api.computeBode($filterResult.num, $filterResult.den, r.min, r.max, $bodePoints))
    } catch (_) {}
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
      define_with: defineWith, name: filterName, denorm,
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

  function getFreqRange() {
    if (isBand) {
      const c = defineWith === 1 ? f0Hz : Math.sqrt(fp1Hz * fp2Hz)
      return { min: c * 0.05, max: c * 20 }
    }
    const ref = isGD ? frgHz : fpHz
    return { min: ref * 0.01, max: ref * 100 }
  }
</script>

<div class="fp">

  <!-- Row 1: type + approx -->
  <div class="g2">
    <div class="f">
      <span class="lbl">Type</span>
      <select class="sel" bind:value={filterType}>
        {#each FILTER_TYPES as t, i}<option value={i}>{t}</option>{/each}
      </select>
    </div>
    <div class="f">
      <span class="lbl">Approx.</span>
      <select class="sel" bind:value={approxType}>
        {#each APPROX_TYPES as a, i}<option value={i}>{a}</option>{/each}
      </select>
    </div>
  </div>

  <!-- Row 2: order range + name -->
  <div class="g3">
    <div class="f">
      <span class="lbl">N min</span>
      <input class="ni" type="number" min="1" max="50" bind:value={nMin} />
    </div>
    <div class="f">
      <span class="lbl">N max</span>
      <input class="ni" type="number" min="1" max="50" bind:value={nMax} />
    </div>
    <div class="f">
      <span class="lbl">Name</span>
      <input class="ni" type="text" bind:value={filterName} placeholder="—" />
    </div>
  </div>

  <div class="div"></div>

  <!-- Frequencies -->
  {#if !isGD}
    {#if !isBand}
      <div class="g2">
        <div class="f"><span class="lbl">fp</span>
          <SciInput bind:value={fpHz} unit="Hz" min={1e-3} max={1e12} /></div>
        <div class="f"><span class="lbl">fa</span>
          <SciInput bind:value={faHz} unit="Hz" min={1e-3} max={1e12} /></div>
      </div>
    {:else}
      <div class="g2" style="align-items:end">
        <div class="f"><span class="lbl">Define by</span>
          <select class="sel" bind:value={defineWith}>
            <option value={1}>f₀ + BW</option>
            <option value={0}>Freqs</option>
          </select>
        </div>
        {#if defineWith === 1}
          <div class="f"><span class="lbl">f₀</span>
            <SciInput bind:value={f0Hz} unit="Hz" min={1e-3} max={1e12} /></div>
        {:else}
          <div class="f"><span class="lbl">fp₁</span>
            <SciInput bind:value={fp1Hz} unit="Hz" min={1e-3} max={1e12} /></div>
        {/if}
      </div>
      {#if defineWith === 1}
        <div class="g2">
          <div class="f"><span class="lbl">BW pass</span>
            <SciInput bind:value={bwpHz} unit="Hz" min={1e-6} max={1e12} /></div>
          <div class="f"><span class="lbl">BW stop</span>
            <SciInput bind:value={bwaHz} unit="Hz" min={1e-6} max={1e12} /></div>
        </div>
      {:else}
        <div class="g2">
          <div class="f"><span class="lbl">fp₂</span>
            <SciInput bind:value={fp2Hz} unit="Hz" min={1e-3} max={1e12} /></div>
          <div class="f"><span class="lbl">fa₁</span>
            <SciInput bind:value={fa1Hz} unit="Hz" min={1e-3} max={1e12} /></div>
        </div>
        <div class="f">
          <span class="lbl">fa₂</span>
          <SciInput bind:value={fa2Hz} unit="Hz" min={1e-3} max={1e12} />
        </div>
      {/if}
    {/if}

    <div class="div"></div>

    <div class="g2">
      {#if showRipple}
        <div class="f"><span class="lbl">Ripple</span>
          <SciInput bind:value={apDb} unit="dB" min={0.001} max={40} logNudge={false} step={0.5} /></div>
      {/if}
      <div class="f" class:full={!showRipple}><span class="lbl">Attenuation</span>
        <SciInput bind:value={aaDb} unit="dB" min={1} max={120} logNudge={false} step={1} /></div>
    </div>

  {:else}
    <!-- Group Delay -->
    <div class="g2">
      <div class="f"><span class="lbl">τ₀</span>
        <SciInput bind:value={tau0} unit="s" min={1e-12} max={1} /></div>
      <div class="f"><span class="lbl">f ref</span>
        <SciInput bind:value={frgHz} unit="Hz" min={1e-3} max={1e12} /></div>
    </div>
    <div class="f">
      <span class="lbl">Tolerance γ (%)</span>
      <input class="ni" type="number" min="0.01" max="99" step="0.5" bind:value={gamma} />
    </div>
  {/if}

  <div class="div"></div>

  <!-- Gain -->
  <div class="f">
    <span class="lbl">Gain</span>
    <SciInput bind:value={gainDb} unit="dB" logNudge={false} step={1} />
  </div>

  <!-- Denormalization slider -->
  <div class="f">
    <span class="lbl">Denorm <span class="dv">{denorm}%</span></span>
    <input class="slider" type="range" min="0" max="100" step="1" bind:value={denorm} />
  </div>

  <div class="div"></div>

  <!-- Plot points selector -->
  <div class="f">
    <span class="lbl">Plot points</span>
    <select class="sel" bind:value={$bodePoints} on:change={onPointsChange}>
      {#each POINTS_OPTIONS as n}
        <option value={n}>{n.toLocaleString()}</option>
      {/each}
    </select>
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
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
    padding: 0.5rem 0.65rem 0.65rem;
  }

  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.38rem; }
  .g3 { display: grid; grid-template-columns: 1fr 1fr 1.6fr; gap: 0.38rem; }

  .f { display: flex; flex-direction: row; align-items: center; gap: 0.4rem; min-width: 0; }
  .f.full { grid-column: 1 / -1; }

  .lbl {
    font-size: 0.67rem;
    color: #7d8590;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .dv {
    color: #c9d1d9;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .sel, .ni {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #e6edf3;
    font-size: 0.8rem;
    padding: 0.28rem 0.4rem;
    flex: 1;
    min-width: 0;
    width: 0;
    outline: none;
  }
  .sel:focus, .ni:focus { border-color: #58a6ff; }
  .ni { font-family: 'SF Mono', 'Fira Code', monospace; }

  .slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 4px;
    border-radius: 2px;
    background: #30363d;
    outline: none;
    cursor: pointer;
    accent-color: #58a6ff;
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #58a6ff;
    cursor: pointer;
    border: 2px solid #0d1117;
  }
  .slider::-moz-range-thumb {
    width: 14px; height: 14px;
    border-radius: 50%;
    background: #58a6ff;
    cursor: pointer;
    border: 2px solid #0d1117;
  }

  .div { height: 1px; background: #21262d; margin: 0.1rem 0; }

  .btn {
    background: #1f6feb;
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
    font-size: 0.83rem;
    font-weight: 600;
    padding: 0.45rem;
    width: 100%;
    margin-top: 0.1rem;
    transition: background 0.15s;
  }
  .btn:hover:not(:disabled) { background: #388bfd; }
  .btn:disabled { background: #21262d; color: #484f58; cursor: default; }

  .err {
    font-size: 0.7rem;
    color: #f85149;
    background: #2d1b1b;
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    word-break: break-word;
    margin: 0;
  }
</style>
