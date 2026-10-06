<script>
  import { filterResult, filterParams, stages, remainingPZ, comparisons, theme, colorMode, colorShuffle, activeTab, plotUnit, dataUnit, hoveredStageId, lang } from '../../stores/app.js'
  import { table, fmt, approxName } from '../../lib/i18n.js'
  import { getWorkerApi } from '../../lib/worker-client.js'
  import { plotColor, sPlaneAxis } from '../../lib/approx.js'
  import { isComplexRoot, rootValue } from '../../lib/roots.js'
  import {
    makeStage, buildStage, rootsModified, rootRef, autoStage, stagePreview, stageName,
  } from '../../lib/stages.js'
  import { colorOf, nextColorIndex } from '../../lib/stage-colors.js'
  import { normOptions } from '../../lib/stage-math.js'
  import PzMap from '../PzMap.svelte'

  const TX = {
    en: {
      poles: 'Poles', zeros: 'Zeros',
      hover: '{noun} (hover)', selected: 'Selected {lower}', selectedHover: 'Selected {lower} (hover)',
      ofPoles: '{name} poles', ofZeros: '{name} zeros',
      ofPolesDesigned: '{name} poles (designed)', ofZerosDesigned: '{name} zeros (designed)',
      selOne: 'Select at least one pole.',
      selTwo: 'A stage takes one or two poles ({n} selected).',
      selImproper: 'More zeros ({z}) than poles ({p}): the stage would be improper.',
      empty: 'Enter a valid template to see its poles and zeros.',
      allPoles: 'All poles assigned.', allZeros: 'All zeros assigned.',
      norm: 'Norm.', normNames: {},
      add: 'Add Stage', adding: 'Adding…',
      auto: 'Auto-stage remaining', autoTitle: 'Split every unassigned root into 2nd / 1st-order sections, low Q first',
      stages: 'Stages ({n})',
    },
    es: {
      poles: 'Polos', zeros: 'Ceros',
      hover: '{noun} (resaltados)', selected: '{noun} seleccionados', selectedHover: '{noun} seleccionados (resaltados)',
      ofPoles: 'Polos {name}', ofZeros: 'Ceros {name}',
      ofPolesDesigned: 'Polos {name} (diseñados)', ofZerosDesigned: 'Ceros {name} (diseñados)',
      selOne: 'Seleccione al menos un polo.',
      selTwo: 'Una etapa lleva uno o dos polos ({n} seleccionados).',
      selImproper: 'Más ceros ({z}) que polos ({p}): la etapa sería impropia.',
      empty: 'Ingrese una plantilla válida para ver sus polos y ceros.',
      allPoles: 'Todos los polos están asignados.', allZeros: 'Todos los ceros están asignados.',
      norm: 'Norm.', normNames: { Passband: 'Banda de paso' },
      add: 'Agregar etapa', adding: 'Agregando…',
      auto: 'Armar etapas con el resto', autoTitle: 'Separar todas las raíces sin asignar en etapas de 2.º / 1.er orden, de menor a mayor Q',
      stages: 'Etapas ({n})',
    },
  }
  $: tx = table(TX, $lang)

  // Selection / hover state, by root id (lib/roots.js): repeated roots such as
  // the band-pass zeros at s = 0 stay individually selectable.
  let selectedIds = new Set()
  let hoveredId = null   // id of the list row currently under the mouse

  // Reset selection whenever a new filter is designed
  $: $filterResult, selectedIds = new Set(), hoveredId = null

  // Engine poles/zeros are rad/s: the plot follows plotUnit, the list dataUnit.
  $: axis     = sPlaneAxis($plotUnit)
  $: listAxis = sPlaneAxis($dataUnit)

  // Format a complex number for display, scaled into the target unit
  function fmtComplex({ re: r, im: i }, k = 1) {
    const rr = (r * k).toFixed(4)
    if (Math.abs(i) < 1e-9) return rr
    const sign = i >= 0 ? '+' : '−'
    return `${rr} ${sign} j${Math.abs(i * k).toFixed(4)}`
  }

  // A complex root toggles together with its conjugate; real roots one at a time.
  function toggleRoot(root) {
    const s = new Set(selectedIds)
    const on = !s.has(root.id)
    for (const id of [root.id, root.conj]) {
      if (id === null) continue
      if (on) s.add(id); else s.delete(id)
    }
    selectedIds = s
  }

  $: selectedZeros = ($remainingPZ.zeros ?? []).filter(z => selectedIds.has(z.id))
  $: selectedPoles = ($remainingPZ.poles ?? []).filter(p => selectedIds.has(p.id))

  // Mirrors the engine's build_stage() limits.
  $: selectionError = (() => {
    if (selectedIds.size === 0) return ''
    if (selectedPoles.length === 0) return tx.selOne
    if (selectedPoles.length > 2) return fmt(tx.selTwo, { n: selectedPoles.length })
    if (selectedZeros.length > selectedPoles.length)
      return fmt(tx.selImproper, { z: selectedZeros.length, p: selectedPoles.length })
    return ''
  })()
  $: selectionValid = selectedPoles.length > 0 && !selectionError

  let normtype = 'Passband'
  // Only the normalizations that work for the selected roots
  $: normOpts = normOptions($filterParams?.filter_type ?? 0, selectedZeros.map(rootValue), selectedPoles.map(rootValue))
  $: if (normOpts.length && !normOpts.includes(normtype)) normtype = normOpts[0]
  let adding = false
  let addError = ''

  async function addStage() {
    adding = true
    addError = ''
    try {
      const api = getWorkerApi()
      const stage = makeStage({
        id: Date.now(),
        name: `Stage ${($stages.length ?? 0) + 1}`,
        zeroIds: selectedZeros.map(r => r.id), poleIds: selectedPoles.map(r => r.id),
        zeros: selectedZeros.map(rootValue), poles: selectedPoles.map(rootValue),
        normtype,
        colorIndex: nextColorIndex($stages),
      })
      const built = await buildStage(api, stage, $filterParams?.filter_type ?? 0)
      stages.update(s => [...s, built])
      selectedIds = new Set()
    } catch (e) {
      addError = e.message
    } finally {
      adding = false
    }
  }

  // ── Pole-zero map ──────────────────────────────────────────────────────────
  $: C = $theme === 'light' ? { hi: '#1f2328' } : { hi: '#e6edf3' }
  $: mainColor = plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle)

  const asRoots = list => list.map(([re, im]) => ({ re, im }))
  const labelled = (rs, k) => rs.map(r => ({ ...r, label: fmtComplex(r, k) }))

  // Refs: 'r:<root id>' for unassigned roots (selectable), 's:<stage id>' for staged ones.
  function buildGroups(fr, remaining, stageList, selIds, hovId, hovStage, mainCol, compList, k, t, ghostId = null) {
    if (!fr?.roots) return []
    const out = []

    // Comparison filters behind the main filter
    for (const comp of compList ?? []) {
      const cc = plotColor(comp.approxType, $theme, $colorMode, $colorShuffle)
      const cn = approxName(comp.approxType, $lang)
      out.push({ roots: labelled(asRoots(comp.filterResult.poles), k), symbol: 'x', color: cc, size: 7, name: fmt(t.ofPoles, { name: cn }) })
      out.push({ roots: labelled(asRoots(comp.filterResult.zeros), k), symbol: 'circle-open', color: cc, size: 7, name: fmt(t.ofZeros, { name: cn }) })
    }

    // Staged roots, in their stage's colour, at their current (possibly moved)
    // position; a faint ghost marks where a moved root was designed.
    stageList.forEach((st, i) => {
      const col = colorOf(st, i, $theme, mainCol)
      const dim = (hovStage != null && hovStage !== st.id) || st.id === ghostId
      const big = hovStage === st.id ? 4 : 0
      const name = stageName(st.name, $lang)
      if (rootsModified(st)) {
        out.push({ roots: labelled(asRoots(st.orig.poles), k), symbol: 'x', color: col, size: 8, opacity: 0.3, name: fmt(t.ofPolesDesigned, { name }), showlegend: false })
        out.push({ roots: labelled(asRoots(st.orig.zeros), k), symbol: 'circle-open', color: col, size: 8, opacity: 0.3, name: fmt(t.ofZerosDesigned, { name }), showlegend: false })
      }
      out.push({ roots: labelled(asRoots(st.poles), k).map((r, j) => ({ ...r, ref: rootRef(st.id, 'p', j) })), symbol: 'x', color: col, size: 9 + big, opacity: dim ? 0.35 : 1, name: fmt(t.ofPoles, { name }) })
      out.push({ roots: labelled(asRoots(st.zeros), k).map((r, j) => ({ ...r, ref: rootRef(st.id, 'z', j) })), symbol: 'circle-open', color: col, size: 9 + big, opacity: dim ? 0.35 : 1, name: fmt(t.ofZeros, { name }) })
    })

    // Unassigned roots: normal / hover / selected / selected + hover
    const hoverSet = new Set()
    if (hovId) {
      hoverSet.add(hovId)
      const h = [...fr.roots.zeros, ...fr.roots.poles].find(r => r.id === hovId)
      if (h && isComplexRoot(h)) hoverSet.add(h.conj)
    }
    const part = (pts, symbol, noun) => {
      const buckets = [[], [], [], []]   // normal, hover, selected, selected+hover
      for (const r of pts) buckets[(selIds.has(r.id) ? 2 : 0) + (hoverSet.has(r.id) ? 1 : 0)].push({ ...r, ref: `r:${r.id}` })
      const [n, h, sel, sh] = buckets
      const v = { noun, lower: noun.toLowerCase() }
      if (n.length)   out.push({ roots: labelled(n, k),   symbol, color: mainCol, size: 10, name: `${noun}` })
      if (h.length)   out.push({ roots: labelled(h, k),   symbol, color: C.hi,    size: 12, name: fmt(t.hover, v) })
      if (sel.length) out.push({ roots: labelled(sel, k), symbol, color: C.hi,    size: 14, name: fmt(t.selected, v) })
      if (sh.length)  out.push({ roots: labelled(sh, k),  symbol, color: C.hi,    size: 16, name: fmt(t.selectedHover, v) })
    }
    part(remaining.poles ?? [], 'x', t.poles)
    part(remaining.zeros ?? [], 'circle-open', t.zeros)
    return out
  }

  // During a staged-root preview (drag / wheel) the Plotly markers stay frozen,
  // with that stage faint as the "before" position; the live roots are drawn by
  // PzMap's canvas overlay on every move. After the commit, the overlay stays
  // until Plotly has redrawn.
  $: previewId = $stagePreview?.id ?? null
  let groups = []
  let ghostFor = null
  let holdOverlay = false
  $: if (previewId == null) { ghostFor = null; groups = buildGroups($filterResult, $remainingPZ, $stages, selectedIds, hoveredId, $hoveredStageId, mainColor, $comparisons, axis.scale, tx) }
  $: if (previewId != null && ghostFor !== previewId) {
    ghostFor = previewId
    holdOverlay = true
    groups = buildGroups($filterResult, $remainingPZ, $stages, selectedIds, hoveredId, null, mainColor, $comparisons, axis.scale, tx, previewId)
  }
  $: overlayStage = holdOverlay ? $stages.find(st => st.id === (previewId ?? ghostForOverlay)) : null
  let ghostForOverlay = null
  $: if (previewId != null) ghostForOverlay = previewId
  $: overlayMarkers = overlayStage ? liveMarkers(overlayStage) : null
  function liveMarkers(st) {
    const col = colorOf(st, $stages.indexOf(st), $theme, mainColor)
    return [
      ...st.poles.map(([re, im]) => ({ re, im, symbol: 'x', color: col, size: 13 })),
      ...st.zeros.map(([re, im]) => ({ re, im, symbol: 'o', color: col, size: 13 })),
    ]
  }
  function onMapRendered() { if (holdOverlay && previewId == null) { holdOverlay = false; ghostForOverlay = null } }

  function onMapHover(e) {
    const ref = e.detail.ref
    if (ref?.startsWith('r:')) { hoveredId = ref.slice(2); hoveredStageId.set(null) }
    // Staged roots: 's:<stageId>:<p|z>:<index>'
    else if (ref?.startsWith('s:')) { hoveredId = null; hoveredStageId.set(Number(ref.split(':')[1])) }
    else { hoveredId = null; hoveredStageId.set(null) }
  }


  // Roots can't be moved here (that's the Stages tab): a click on an unassigned
  // root (de)selects it, with its conjugate, for the next stage.
  function onMapClick(e) {
    const ref = e.detail.ref
    if (!ref?.startsWith('r:')) return
    const id = ref.slice(2)
    const root = [...($remainingPZ.zeros ?? []), ...($remainingPZ.poles ?? [])].find(r => r.id === id)
    if (root) toggleRoot(root)
  }
</script>

<div class="pz-tab">
  <!-- Plot -->
  <div class="plot-wrap">
    <PzMap
      {groups}
      scale={axis.scale}
      xLabel={axis.xLabel}
      yLabel={axis.yLabel}
      active={$activeTab === 'poleZero'}
      resetKey={$filterResult}
      on:hover={onMapHover}
      {overlayMarkers}
      canClick={ref => ref?.startsWith('r:')}
      on:click={onMapClick}
      on:rendered={onMapRendered}
    />
  </div>

  <!-- Selection panel -->
  <div class="panel">
    {#if !$filterResult}
      <p class="hint">{tx.empty}</p>
    {:else}
      <div class="sec">{tx.poles} [{listAxis.unit}]</div>

      {#if ($remainingPZ.poles ?? []).length === 0}
        <p class="hint-sm">{tx.allPoles}</p>
      {:else}
        {#each ($remainingPZ.poles ?? []) as p (p.id)}
          <label class="pz-row" class:sel={selectedIds.has(p.id)} class:hov={hoveredId === p.id}
            on:mouseenter={() => hoveredId = p.id} on:mouseleave={() => hoveredId = null}>
            <input type="checkbox" checked={selectedIds.has(p.id)} on:change={() => toggleRoot(p)} />
            <span class="val" style="color: {mainColor}">{fmtComplex(p, listAxis.scale)}</span>
          </label>
        {/each}
      {/if}

      {#if ($filterResult.zeros ?? []).length > 0}
        <div class="sec mt">{tx.zeros} [{listAxis.unit}]</div>
        {#if ($remainingPZ.zeros ?? []).length === 0}
          <p class="hint-sm">{tx.allZeros}</p>
        {:else}
          {#each ($remainingPZ.zeros ?? []) as z (z.id)}
            <label class="pz-row" class:sel={selectedIds.has(z.id)} class:hov={hoveredId === z.id}
              on:mouseenter={() => hoveredId = z.id} on:mouseleave={() => hoveredId = null}>
              <input type="checkbox" checked={selectedIds.has(z.id)} on:change={() => toggleRoot(z)} />
              <span class="val" style="color: {mainColor}">{fmtComplex(z, listAxis.scale)}</span>
            </label>
          {/each}
        {/if}
      {/if}

      <div class="div"></div>

      {#if selectionError}
        <p class="warn">{selectionError}</p>
      {/if}
      {#if addError}<p class="err">{addError}</p>{/if}

      <div class="norm-row">
        <span class="norm-lbl">{tx.norm}</span>
        <select class="norm-sel" bind:value={normtype}>
          {#each normOpts as n}<option value={n}>{tx.normNames[n] ?? n}</option>{/each}
        </select>
      </div>

      <button class="add-btn" disabled={!selectionValid || adding} on:click={addStage}>
        {adding ? tx.adding : tx.add}
      </button>
      <button class="auto-btn" disabled={adding || !(($remainingPZ.poles ?? []).length)}
        title={tx.autoTitle}
        on:click={async () => { adding = true; try { await autoStage(); selectedIds = new Set() } finally { adding = false } }}>
        {tx.auto}
      </button>

      {#if $stages.length > 0}
        <div class="div"></div>
        <div class="sec">{fmt(tx.stages, { n: $stages.length })}</div>
        {#each $stages as stage, i (stage.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="stage-row" class:hov={$hoveredStageId === stage.id}
            on:mouseenter={() => hoveredStageId.set(stage.id)} on:mouseleave={() => hoveredStageId.set(null)}>
            <span class="sdot" style:background={colorOf(stage, i, $theme, mainColor)}></span>
            <span class="sname">{stageName(stage.name, $lang)}</span>
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
  .auto-btn {
    background: none; border: 1px solid var(--accent); border-radius: 6px; color: var(--accent);
    cursor: pointer; font-size: 0.78rem; padding: 0.3rem; width: 100%; margin-top: 0.25rem;
  }
  .auto-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .auto-btn:disabled { opacity: 0.4; cursor: default; }
  .add-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .add-btn:disabled { background: var(--surface-2); color: var(--disabled); cursor: default; }

  .stage-row {
    display: flex; align-items: center; gap: 0.3rem;
    padding: 0.2rem 0.3rem; border-radius: 3px;
    background: var(--surface-2);
    min-width: 0;
  }
  .sdot { width: 0.55rem; height: 0.55rem; border-radius: 50%; flex-shrink: 0; }
  .sname { font-size: 0.75rem; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .stage-row.hov { box-shadow: inset 0 0 0 1px var(--accent); }
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
