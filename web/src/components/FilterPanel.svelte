<script>
  import { TWO_PI } from '../lib/approx.js'
  import { liveDenorm } from '../lib/design-action.js'
  import {
    LP, HP, BP, BR, GD, F0_BW, FREQS, allowedApprox, defaultApprox,
    isBand as isBandType, formFromParams, rescaleForm, validateForm, switchFilterType,
  } from '../lib/params.js'
  import {
    designForm, pendingFormHydration, dataUnit, designError, lang,
  } from '../stores/app.js'
  import { table, fmt, typeName, TYPE_SHORT } from '../lib/i18n.js'
  import Segmented  from './form/Segmented.svelte'
  import NumField   from './form/NumField.svelte'
  import ApproxTiles from './form/ApproxTiles.svelte'

  // ── Strings ───────────────────────────────────────────────────────────────
  const TX = {
    en: {
      specs: 'Specs', template: 'Template', output: 'Output',
      filterType: 'Filter type', defineBy: 'Define band by',
      f0bw: 'f₀ + BW', f0bwTitle: 'Define the band by its centre frequency and bandwidths',
      edges: 'Edges', edgesTitle: 'Define the band by its four edge frequencies',
      gdNA: 'not available for group delay',
      magNA: 'only for low-pass and group delay',
      fref: '{f} ref',
      fp: '{f}p (pass)', fa: '{f}a (stop)',
      f0Title: 'Centre frequency, {u}',
      bwp: 'BWp', bwpTitle: 'Passband width, {u} (drag the label to adjust)',
      bwa: 'BWa', bwaTitle: 'Stopband width, {u} (drag the label to adjust)',
      passEdge: 'Passband', stopEdge: 'Stopband', low: '1 (low)', high: '2 (high)',
      edgeTitle: '{kind} edge {which}, {u}',
      ripple: 'Ripple', rippleTitle: '',
      atten: 'Attenuation', attenTitle: '',
      gain: 'Gain',
      denorm: 'Denorm', denormAria: 'Denormalization',
      denormTitle: 'Where the normalization lands between the passband edge (0 %) and the stopband edge (100 %)',
      denormGD: 'Not used for group delay: the design is set by τ₀, f ref and γ',
    },
    es: {
      specs: 'Especificaciones', template: 'Plantilla', output: 'Salida',
      filterType: 'Tipo de filtro', defineBy: 'Definir la banda por',
      f0bw: 'f₀ + B', f0bwTitle: 'Definir la banda por su frecuencia central y sus anchos de banda',
      edges: 'Bordes', edgesTitle: 'Definir la banda por sus cuatro frecuencias de borde',
      gdNA: 'no disponible para retardo de grupo',
      magNA: 'solo para pasa-bajos y retardo de grupo',
      fref: '{f} ref',
      fp: '{f}p (paso)', fa: '{f}a (atenuación)',
      f0Title: 'Frecuencia central, {u}',
      bwp: 'Bp', bwpTitle: 'Ancho de la banda de paso, {u} (arrastre la etiqueta para ajustar)',
      bwa: 'Ba', bwaTitle: 'Ancho de la banda de atenuación, {u} (arrastre la etiqueta para ajustar)',
      passEdge: 'Frecuencia de paso', stopEdge: 'Frecuencia de atenuación', low: '1 (inferior)', high: '2 (superior)',
      edgeTitle: '{kind} {which}, {u}',
      ripple: 'Ap', rippleTitle: 'Ap: atenuación máxima en la banda de paso (arrastre para ajustar)',
      atten: 'Aa', attenTitle: 'Aa: atenuación mínima en la banda de atenuación (arrastre para ajustar)',
      gain: 'Ganancia',
      denorm: 'Desnorm.', denormAria: 'Desnormalización',
      denormTitle: 'Dónde cae la normalización entre la frecuencia de paso (0 %) y la de atenuación (100 %)',
      denormGD: 'No se usa en retardo de grupo: el diseño queda fijado por τ₀, f ref y γ',
    },
  }
  $: tx = table(TX, $lang)

  // ── Constants ─────────────────────────────────────────────────────────────
  // Response-shape glyphs, 24×12 viewBox.
  const TYPE_GLYPHS = [
    'M1 3 H11 L17 10 H23',
    'M1 10 H7 L13 3 H23',
    'M1 10 H5 L9 3 H15 L19 10 H23',
    'M1 3 H6 L10 10 H14 L18 3 H23',
    'M1 6 H23 M3 2.5 V9.5 M21 2.5 V9.5',
  ]
  $: TYPE_OPTIONS = [LP, HP, BP, BR, GD].map(v => (
    { value: v, label: TYPE_SHORT[v], title: typeName(v, $lang), glyph: TYPE_GLYPHS[v] }
  ))
  $: DEFINE_OPTIONS = [
    { value: F0_BW, label: tx.f0bw, title: tx.f0bwTitle },
    { value: FREQS, label: tx.edges, title: tx.edgesTitle },
  ]

  // ── Units ─────────────────────────────────────────────────────────────────
  // Form frequencies ($designForm) are held in the current data unit (Hz or
  // rad/s); params sent to the engine are always rad/s.
  /** Hz value × uf = value in the current data unit. */
  $: uf     = $dataUnit === 'rad' ? TWO_PI : 1
  $: toRad  = TWO_PI / uf
  $: uLabel = $dataUnit === 'rad' ? 'rad/s' : 'Hz'
  /** Symbol prefix: f for Hz, ω for rad/s. */
  $: fsym   = $dataUnit === 'rad' ? 'ω' : 'f'
  $: fMin   = 1e-3 * uf
  $: fMax   = 1e12 * uf
  $: bwMin  = 1e-6 * uf

  // Rescale the entered values so the physical frequencies survive a unit flip.
  let lastUnit = $dataUnit
  $: if ($dataUnit !== lastUnit) {
    const k = $dataUnit === 'rad' ? TWO_PI : 1 / TWO_PI
    lastUnit = $dataUnit
    designForm.update(f => rescaleForm(f, k))
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  $: ft         = $designForm.filterType
  $: isBand     = isBandType(ft)
  $: isGD       = ft === GD
  $: formErrors = validateForm($designForm, $lang)
  /** First validation message of the band fields (shown under their one-row layout). */
  $: bandError = ['f0', 'bwp', 'bwa', 'fp1', 'fp2', 'fa1', 'fa2'].map(k => formErrors[k]).find(Boolean) ?? ''

  function onTypeChange(e) {
    designForm.update(f => {
      const next = switchFilterType(f, e.detail)
      // GD only supports Bessel / Gauss; HP / BP / BR everything but them.
      const allow = allowedApprox(e.detail)
      if (allow && !allow.has(next.approxType)) next.approxType = defaultApprox(e.detail)
      return next
    })
  }

  function setApprox(i) {
    designForm.update(f => ({ ...f, approxType: i }))
  }

  // Apply params from Save/Load without re-running Design.
  $: if ($pendingFormHydration) {
    designForm.update(f => formFromParams($pendingFormHydration, toRad, f))
    pendingFormHydration.set(null)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  // Editing the form clears the last engine error (depends on $designForm only).
  // Every edit re-designs by itself (lib/design-action.js, live updates).
  const clearError = () => designError.set('')
  $: clearError($designForm)

  // ── Live denorm (T3): see liveDenorm in lib/design-action.js ──────────────
  function onDenormInput() {
    if (liveDenorm.start()) liveDenorm.update($designForm.denorm)
  }

  function onDenormRelease() {
    liveDenorm.end()
  }
</script>

<div class="fp">

  <!-- ── Specs ─────────────────────────────────────────────────────────── -->
  <div class="group">{tx.specs}</div>

  <Segmented options={TYPE_OPTIONS} value={ft} ariaLabel={tx.filterType} on:change={onTypeChange} />

  <ApproxTiles
    value={$designForm.approxType}
    allowed={allowedApprox(ft)}
    disabledTitle={isGD ? tx.gdNA : tx.magNA}
    on:change={e => setApprox(e.detail)}
  />
  {#if formErrors.approxType}<p class="hint">{formErrors.approxType}</p>{/if}


  <!-- ── Template ──────────────────────────────────────────────────────── -->
  <div class="group group-row">
    <span>{tx.template}{#if isBand}<span class="unit-cap"> · {uLabel}</span>{/if}</span>
    {#if isBand}
      <Segmented size="sm" options={DEFINE_OPTIONS} bind:value={$designForm.defineWith} ariaLabel={tx.defineBy} />
    {/if}
  </div>

  {#if isGD}
    <NumField label="τ₀" bind:value={$designForm.tau0} unit="s" min={1e-12} max={1} error={formErrors.tau0} edge="tau0" group="centre" />
    <NumField label={fmt(tx.fref, { f: fsym })} bind:value={$designForm.frg} unit={uLabel} min={fMin} max={fMax} error={formErrors.frg} edge="frg" group="pass" />
    <NumField label="γ" bind:value={$designForm.gamma} unit="%" min={0.01} max={99} log={false} step={0.5} error={formErrors.gamma} edge="gamma" group="pass" />
  {:else}
    {#if !isBand}
      <div class="pair">
        <NumField layout="stack" label={fmt(tx.fp, { f: fsym })} bind:value={$designForm.fp} edge="fp" group="pass" unit={uLabel} min={fMin} max={fMax} error={formErrors.fp} />
        <NumField layout="stack" label={fmt(tx.fa, { f: fsym })} bind:value={$designForm.fa} edge="fa" group="stop" unit={uLabel} min={fMin} max={fMax} error={formErrors.fa} />
      </div>
    {:else}
      <!-- One row, like LP / HP, so band types don't make the sidebar scroll; unit in the header -->
      {#if $designForm.defineWith === F0_BW}
        <div class="tri">
          <NumField layout="stack" label="{fsym}₀" title={fmt(tx.f0Title, { u: uLabel })} bind:value={$designForm.f0} edge="f0" group="centre" min={fMin} max={fMax} showHint={false} error={formErrors.f0} />
          <NumField layout="stack" label={tx.bwp} title={fmt(tx.bwpTitle, { u: uLabel })} bind:value={$designForm.bwp} edge="bwp" group="pass" min={bwMin} max={fMax} showHint={false} error={formErrors.bwp} />
          <NumField layout="stack" label={tx.bwa} title={fmt(tx.bwaTitle, { u: uLabel })} bind:value={$designForm.bwa} edge="bwa" group="stop" min={bwMin} max={fMax} showHint={false} error={formErrors.bwa} />
        </div>
        {#if bandError}<p class="hint">{bandError}</p>{/if}
      {:else}
        <!-- Edges in frequency order (green = passband, amber = stopband); unit in the header -->
        <div class="quad">
          {#each (ft === BP ? ['fa1', 'fp1', 'fp2', 'fa2'] : ['fp1', 'fa1', 'fa2', 'fp2']) as k (k)}
            {@const pass = k.startsWith('fp')}
            <NumField layout="stack" label="{fsym}{pass ? 'p' : 'a'}{k.endsWith('1') ? '₁' : '₂'}"
              title={fmt(tx.edgeTitle, { kind: pass ? tx.passEdge : tx.stopEdge, which: k.endsWith('1') ? tx.low : tx.high, u: uLabel })}
              bind:value={$designForm[k]} edge={k} group={pass ? 'pass' : 'stop'} min={fMin} max={fMax} showHint={false} error={formErrors[k]} />
          {/each}
        </div>
        {#if bandError}<p class="hint">{bandError}</p>{/if}
      {/if}
    {/if}

    <div class="pair">
      <NumField layout="stack" label={tx.ripple} title={tx.rippleTitle} bind:value={$designForm.apDb} edge="apDb" group="pass" unit="dB" min={0.001} max={40} log={false} step={0.1} error={formErrors.apDb} />
      <NumField layout="stack" label={tx.atten} title={tx.attenTitle} bind:value={$designForm.aaDb} edge="aaDb" group="stop" unit="dB" min={1} max={120} log={false} step={1} error={formErrors.aaDb} />
    </div>
  {/if}

  <!-- ── Output ────────────────────────────────────────────────────────── -->
  <div class="group">{tx.output}</div>

  <NumField label={tx.gain} bind:value={$designForm.gainDb} unit="dB" min={-200} max={200} log={false} step={1} />

  <!-- Group delay has no denormalization: the engine scales the prototype by 1/τ₀ only. -->
  <div class="denorm-row" class:off={isGD}
    title={isGD ? tx.denormGD : ''}>
    <span class="lbl" title={isGD ? '' : tx.denormTitle}>{tx.denorm}</span>
    <div class="denorm">
      <input class="slider" type="range" min="0" max="100" step="1" bind:value={$designForm.denorm} aria-label={tx.denormAria}
        disabled={isGD}
        on:input={onDenormInput} on:change={onDenormRelease} on:pointerup={onDenormRelease} on:blur={onDenormRelease} />
      <span class="pct">{isGD ? '—' : `${$designForm.denorm}%`}</span>
    </div>
  </div>

  {#if $designError}
    <p class="err">{$designError}</p>
  {/if}

</div>

<style>
  .fp {
    --lbl-w: 5.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.5rem 0.7rem 0.75rem;
  }

  .group {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-top: 0.35rem;
    padding-bottom: 0.15rem;
    border-bottom: 1px solid var(--surface-2);
  }
  .group:first-child { margin-top: 0; }
  .group-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; min-height: 1.35rem; }
  .unit-cap { text-transform: none; font-weight: 500; letter-spacing: 0; }

  .tri, .quad { display: grid; gap: 0.4rem; min-width: 0; align-items: start; }
  .tri  { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .quad { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.3rem; }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem;
    min-width: 0;
    align-items: start;
  }

  .lbl {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.2;
    white-space: nowrap;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--danger);
    margin: -0.2rem 0 0;
    overflow-wrap: anywhere;
  }


  /* Denorm */
  .denorm-row.off { opacity: 0.4; }
  .denorm-row.off .slider { cursor: not-allowed; }
  .denorm-row {
    display: grid;
    grid-template-columns: var(--lbl-w) minmax(0, 1fr);
    align-items: center;
    gap: 0.45rem;
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
