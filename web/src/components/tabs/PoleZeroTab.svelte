<script>
  import { onMount, onDestroy } from 'svelte'
  import Plotly from 'plotly.js-dist'
  import { filterResult, filterParams, stages, remainingPZ, comparisons, pzKey, theme, colorMode, colorShuffle, showLegend, activeTab } from '../../stores/app.js'
  import { getWorkerApi } from '../../lib/worker-client.js'
  import { APPROX_NAMES, plotColor } from '../../lib/approx.js'

  let container
  let plotMounted = false
  let destroyed = false
  let resizeObserver
  let wasActive = false

  // Selection / hover state
  let selectedKeys = new Set()
  let hoveredKey = null   // pzKey of the list row currently under the mouse

  // Reset selection whenever a new filter is designed
  $: $filterResult, selectedKeys = new Set(), hoveredKey = null

  // Format a complex number for display
  function fmtComplex([r, i]) {
    const rr = r.toFixed(4)
    if (Math.abs(i) < 1e-9) return rr
    const sign = i >= 0 ? '+' : '−'
    return `${rr} ${sign} j${Math.abs(i).toFixed(4)}`
  }

  function toggleKey(pt) {
    const key = pzKey(pt)
    const s = new Set(selectedKeys)
    if (s.has(key)) {
      s.delete(key)
      if (isComplex(pt)) s.delete(conjugateKey(pt))
    } else {
      s.add(key)
      if (isComplex(pt)) s.add(conjugateKey(pt))
    }
    selectedKeys = s
  }

  function isComplex([, i]) { return Math.abs(i) > 1e-9 }
  function conjugateKey([r, i]) { return pzKey([r, -i]) }

  $: selectedZeros = ($remainingPZ.zeros ?? []).filter(z => selectedKeys.has(pzKey(z)))
  $: selectedPoles = ($remainingPZ.poles ?? []).filter(p => selectedKeys.has(pzKey(p)))

  $: selectionValid = (() => {
    if (selectedPoles.length === 0) return false
    for (const p of selectedPoles) {
      if (isComplex(p) && !selectedKeys.has(conjugateKey(p))) return false
    }
    for (const z of selectedZeros) {
      if (isComplex(z) && !selectedKeys.has(conjugateKey(z))) return false
    }
    return true
  })()

  const NORM_OPTIONS = ['Passband', 'ω→0', 'ω→∞', 'ω→ω0']
  let normtype = 'Passband'
  let adding = false
  let addError = ''

  async function addStage() {
    adding = true
    addError = ''
    try {
      const api = getWorkerApi()
      const result = await api.buildStageFromZPK(selectedZeros, selectedPoles, 1, normtype, $filterParams?.filter_type ?? 0)
      if (result.error) { addError = result.error; return }
      const id = Date.now()
      const name = `Stage ${($stages.length ?? 0) + 1}`
      stages.update(s => [...s, {
        id, name,
        zeros: selectedZeros, poles: selectedPoles,
        gain: result.gain, num: result.num, den: result.den,
      }])
      selectedKeys = new Set()
    } catch (e) {
      addError = e.message
    } finally {
      adding = false
    }
  }

  // ── Plotly ─────────────────────────────────────────────────────────────────
  $: C = $theme === 'light'
    ? { hi: '#1f2328', used: '#8c959f', unit: '#d0d7de', grid: '#d8dee4', bg: '#f6f8fa', axis: '#afb8c1', zero: '#afb8c1' }
    : { hi: '#e6edf3', used: '#484f58', unit: '#30363d', grid: '#21262d', bg: '#0d1117', axis: '#484f58', zero: '#52565c' }

  $: mainColor = plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle)

  function buildTraces(fr, remaining, selKeys, hovKey, mainCol, compList) {
    if (!fr) return []
    const avail = new Set([
      ...(remaining.zeros ?? []).map(pzKey),
      ...(remaining.poles ?? []).map(pzKey),
    ])
    const θ = Array.from({ length: 361 }, (_, i) => i * Math.PI / 180)
    // Unit circle only — Re/Im axes come from Plotly zerolines (avoids double-thick axes).
    const out = [
      { x: θ.map(Math.cos), y: θ.map(Math.sin),
        mode: 'lines', line: { color: C.unit, width: 1, dash: 'dot' },
        hoverinfo: 'skip', showlegend: false },
    ]

    // Hover set: hovered key + its conjugate (so both of a complex pair light up)
    const hoverSet = new Set()
    if (hovKey) {
      hoverSet.add(hovKey)
      // find the point to get its conjugate
      const allPts = [...(remaining.zeros ?? []), ...(remaining.poles ?? [])]
      const hovPt = allPts.find(pt => pzKey(pt) === hovKey)
      if (hovPt && isComplex(hovPt)) hoverSet.add(conjugateKey(hovPt))
    }

    // Partition each group into: normal / hoverOnly / selOnly / selHover
    function partition(pts) {
      const normal = [], hoverOnly = [], selOnly = [], selHover = []
      for (const pt of pts) {
        const k = pzKey(pt)
        const h = hoverSet.has(k), s = selKeys.has(k)
        if (s && h)       selHover.push(pt)
        else if (s)       selOnly.push(pt)
        else if (h)       hoverOnly.push(pt)
        else              normal.push(pt)
      }
      return { normal, hoverOnly, selOnly, selHover }
    }

    const usedPoles = fr.poles.filter(p => !avail.has(pzKey(p)))
    const usedZeros = fr.zeros.filter(z => !avail.has(pzKey(z)))
    const { normal: nP, hoverOnly: hoP, selOnly: soP, selHover: shP } = partition(remaining.poles ?? [])
    const { normal: nZ, hoverOnly: hoZ, selOnly: soZ, selHover: shZ } = partition(remaining.zeros ?? [])

    // Comparison filters drawn first (behind main filter)
    for (const comp of (compList ?? [])) {
      const cc = plotColor(comp.approxType, $theme, $colorMode, $colorShuffle)
      const cn = APPROX_NAMES[comp.approxType]
      if (comp.filterResult.poles.length) out.push(mkX(comp.filterResult.poles, cc, 7, `${cn} poles`))
      if (comp.filterResult.zeros.length) out.push(mkO(comp.filterResult.zeros, cc, 7, `${cn} zeros`))
    }

    // Main filter
    if (usedPoles.length) out.push(mkX(usedPoles, C.used,  8,  'Used poles'))
    if (usedZeros.length) out.push(mkO(usedZeros, C.used,  8,  'Used zeros'))
    if (nP.length)        out.push(mkX(nP,        mainCol, 10, 'Poles'))
    if (nZ.length)        out.push(mkO(nZ,        mainCol, 10, 'Zeros'))
    if (hoP.length)       out.push(mkX(hoP,       C.hi,    12, 'Poles (hover)'))
    if (hoZ.length)       out.push(mkO(hoZ,       C.hi,    12, 'Zeros (hover)'))
    if (soP.length)       out.push(mkX(soP,       C.hi,    14, 'Selected poles'))
    if (soZ.length)       out.push(mkO(soZ,       C.hi,    14, 'Selected zeros'))
    if (shP.length)       out.push(mkX(shP,       C.hi,    16, 'Selected poles (hover)'))
    if (shZ.length)       out.push(mkO(shZ,       C.hi,    16, 'Selected zeros (hover)'))
    return out
  }

  function mkX(pts, color, size, name) {
    return {
      x: pts.map(([r]) => r), y: pts.map(([, i]) => i),
      mode: 'markers', name,
      marker: { symbol: 'x', size, color, line: { width: 2, color } },
      hovertemplate: pts.map(p => `${fmtComplex(p)}<extra>${name}</extra>`),
    }
  }

  function mkO(pts, color, size, name) {
    return {
      x: pts.map(([r]) => r), y: pts.map(([, i]) => i),
      mode: 'markers', name,
      marker: { symbol: 'circle-open', size, color, line: { width: 2 } },
      hovertemplate: pts.map(p => `${fmtComplex(p)}<extra>${name}</extra>`),
    }
  }

  const mkLayout = () => {
    const text = $theme === 'light' ? '#1f2328' : '#e6edf3'
    const baseFont = { color: text, size: 12, family: 'system-ui, sans-serif' }
    const tickFont = { color: text, size: 11, family: 'system-ui, sans-serif' }
    return {
    paper_bgcolor: C.bg, plot_bgcolor: C.bg,
    font: baseFont,
    showlegend: $showLegend,
    margin: { t: 36, b: 56, l: 64, r: 24 },
    legend: {
      bgcolor:     $theme === 'light' ? '#ffffff' : '#161b22',
      bordercolor: $theme === 'light' ? '#d0d7de' : '#30363d',
      borderwidth: 1,
      font:        { size: 11, family: 'system-ui, sans-serif' },
      x: 1, xanchor: 'right',
      y: 0.98, yanchor: 'top',
      tracegroupgap: 4,
    },
    xaxis: {
      title: { text: '$\\mathrm{Re}(s)$', standoff: 8, font: baseFont },
      gridcolor: C.grid,
      linecolor: C.axis,
      tickcolor: C.axis,
      tickfont: tickFont,
      zeroline: true,
      zerolinecolor: C.zero,
      zerolinewidth: 1.5,
      scaleanchor: 'y', scaleratio: 1,
    },
    yaxis: {
      title: { text: '$\\mathrm{Im}(s)$', standoff: 8, font: baseFont },
      gridcolor: C.grid,
      linecolor: C.axis,
      tickcolor: C.axis,
      tickfont: tickFont,
      zeroline: true,
      zerolinecolor: C.zero,
      zerolinewidth: 1.5,
    },
    modebar: {
      color:       $theme === 'light' ? '#57606a' : '#7d8590',
      activecolor: $theme === 'light' ? '#0969da' : '#58a6ff',
      bgcolor:     $theme === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(22,27,34,0.85)',
    },
  }
  }

  const cfg = { responsive: true, displaylogo: false,
    toImageButtonOptions: { format: 'svg', filename: 'filtool_pz' } }

  function refreshTitles() {
    if (!plotMounted || destroyed || !container) return
    Plotly.react(
      container,
      buildTraces($filterResult, $remainingPZ, selectedKeys, hoveredKey, mainColor, $comparisons),
      mkLayout(),
      cfg,
    )
    Plotly.Plots.resize(container)
  }

  $: if (plotMounted && $activeTab === 'poleZero' && !wasActive) {
    wasActive = true
    requestAnimationFrame(() => requestAnimationFrame(refreshTitles))
  } else if ($activeTab !== 'poleZero') {
    wasActive = false
  }

  function mountPlot() {
    if (!container || destroyed) return
    Plotly.newPlot(container, buildTraces($filterResult, $remainingPZ, selectedKeys, hoveredKey, mainColor, $comparisons), mkLayout(), cfg)
    plotMounted = true
    wasActive = $activeTab === 'poleZero'
    resizeObserver = new ResizeObserver(() => {
      if (plotMounted && !destroyed && container) Plotly.Plots.resize(container)
    })
    resizeObserver.observe(container)
    // Layout may not be final on first paint (esp. when tab was visibility-hidden).
    requestAnimationFrame(() => {
      if (plotMounted && !destroyed && container) {
        Plotly.Plots.resize(container)
        if ($activeTab === 'poleZero') refreshTitles()
      }
    })
  }

  function updatePlot() {
    if (!plotMounted || destroyed || !container) return
    Plotly.react(container, buildTraces($filterResult, $remainingPZ, selectedKeys, hoveredKey, mainColor, $comparisons), mkLayout(), cfg)
  }

  $: updatePlot(), [$filterResult, $remainingPZ, selectedKeys, hoveredKey, mainColor, $comparisons, $theme, $colorMode, $colorShuffle, $showLegend]

  onMount(mountPlot)
  onDestroy(() => {
    destroyed = true
    plotMounted = false
    resizeObserver?.disconnect()
    if (container) Plotly.purge(container)
  })
</script>

<div class="pz-tab">
  <!-- Plot -->
  <div class="plot-wrap" bind:this={container}></div>

  <!-- Selection panel -->
  <div class="panel">
    {#if !$filterResult}
      <p class="hint">Design a filter to see its poles and zeros.</p>
    {:else}
      <div class="sec">Poles</div>

      {#if ($remainingPZ.poles ?? []).length === 0}
        <p class="hint-sm">All poles assigned.</p>
      {:else}
        {#each ($remainingPZ.poles ?? []) as p (pzKey(p))}
          {@const key = pzKey(p)}
          <label class="pz-row" class:sel={selectedKeys.has(key)} class:hov={hoveredKey === key}
            on:mouseenter={() => hoveredKey = key} on:mouseleave={() => hoveredKey = null}>
            <input type="checkbox" checked={selectedKeys.has(key)} on:change={() => toggleKey(p)} />
            <span class="val" style="color: {mainColor}">{fmtComplex(p)}</span>
          </label>
        {/each}
      {/if}

      {#if ($filterResult.zeros ?? []).length > 0}
        <div class="sec mt">Zeros</div>
        {#if ($remainingPZ.zeros ?? []).length === 0}
          <p class="hint-sm">All zeros assigned.</p>
        {:else}
          {#each ($remainingPZ.zeros ?? []) as z (pzKey(z))}
            {@const key = pzKey(z)}
            <label class="pz-row" class:sel={selectedKeys.has(key)} class:hov={hoveredKey === key}
              on:mouseenter={() => hoveredKey = key} on:mouseleave={() => hoveredKey = null}>
              <input type="checkbox" checked={selectedKeys.has(key)} on:change={() => toggleKey(z)} />
              <span class="val" style="color: {mainColor}">{fmtComplex(z)}</span>
            </label>
          {/each}
        {/if}
      {/if}

      <div class="div"></div>

      {#if selectedKeys.size > 0 && !selectionValid}
        <p class="warn">Select at least one pole.</p>
      {/if}
      {#if addError}<p class="err">{addError}</p>{/if}

      <div class="norm-row">
        <span class="norm-lbl">Norm.</span>
        <select class="norm-sel" bind:value={normtype}>
          {#each NORM_OPTIONS as n}<option value={n}>{n}</option>{/each}
        </select>
      </div>

      <button class="add-btn" disabled={!selectionValid || adding} on:click={addStage}>
        {adding ? 'Adding…' : 'Add Stage'}
      </button>

      {#if $stages.length > 0}
        <div class="div"></div>
        <div class="sec">Stages ({$stages.length})</div>
        {#each $stages as stage (stage.id)}
          <div class="stage-row">
            <span class="sname">{stage.name}</span>
            <span class="sdet">{stage.poles.length}P/{stage.zeros.length}Z</span>
            <button class="rm" on:click={() => stages.update(s => s.filter(st => st.id !== stage.id))}>×</button>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<style>
  .pz-tab {
    display: flex;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .plot-wrap { flex: 1; min-width: 0; min-height: 0; width: 100%; height: 100%; }

  .panel {
    width: min(260px, 42vw);
    flex-shrink: 0;
    background: var(--surface);
    border-left: 1px solid var(--surface-2);
    overflow-x: auto;
    overflow-y: auto;
    padding: 0.5rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .sec {
    font-size: 0.68rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .sec.mt { margin-top: 0.45rem; }

  .pz-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.25rem;
    border-radius: 3px;
    cursor: pointer;
    user-select: none;
    min-width: 0;
  }
  .pz-row:hover { background: var(--surface-2); }
  .pz-row.hov { background: var(--success-bg); }
  .pz-row.sel { background: var(--selected); }
  .pz-row.sel.hov { background: var(--selected); }

  .pz-row input[type=checkbox] {
    accent-color: var(--accent);
    width: 13px; height: 13px;
    flex-shrink: 0; cursor: pointer;
  }

  .val {
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 0.74rem;
    white-space: nowrap;
    overflow: visible;
  }

  .div { height: 1px; background: var(--surface-2); margin: 0.3rem 0; }

  .hint {
    font-size: 0.8rem;
    color: var(--text-dim);
    text-align: left;
    padding: 0.75rem 0.35rem;
    overflow-wrap: anywhere;
  }
  .hint-sm { font-size: 0.7rem; color: var(--disabled); margin: 0; overflow-wrap: anywhere; }

  .warn {
    font-size: 0.72rem; color: var(--warning);
    background: var(--warning-bg); border-radius: 3px;
    padding: 0.28rem 0.4rem; margin: 0;
    overflow-wrap: anywhere;
  }
  .err {
    font-size: 0.72rem; color: var(--danger);
    background: var(--danger-bg); border-radius: 3px;
    padding: 0.28rem 0.4rem; margin: 0;
    overflow-wrap: anywhere;
  }

  .norm-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.1rem;
    min-width: 0;
  }
  .norm-lbl { font-size: 0.68rem; color: var(--text-dim); white-space: nowrap; }
  .norm-sel {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    font-size: 0.75rem;
    padding: 0.22rem 0.3rem;
    outline: none;
  }
  .norm-sel:focus { border-color: var(--accent); }

  .add-btn {
    background: var(--accent-strong); border: none; border-radius: 4px;
    color: #fff; cursor: pointer;
    font-size: 0.8rem; font-weight: 600;
    padding: 0.38rem; width: 100%;
  }
  .add-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .add-btn:disabled { background: var(--surface-2); color: var(--disabled); cursor: default; }

  .stage-row {
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0.2rem 0.3rem; border-radius: 3px;
    background: var(--surface-2);
    min-width: 0;
  }
  .sname { font-size: 0.75rem; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .sdet { font-size: 0.68rem; color: var(--text-dim); flex-shrink: 0; }
  .rm {
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; font-size: 0.85rem; line-height: 1;
    padding: 0 0.1rem; border-radius: 3px;
  }
  .rm:hover { color: var(--danger); background: var(--danger-bg); }

  @media (max-width: 720px) {
    .pz-tab { flex-direction: column; }
    .panel {
      width: 100%;
      max-height: 38vh;
      border-left: none;
      border-top: 1px solid var(--surface-2);
    }
  }
</style>
