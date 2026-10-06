<script>
  import { onMount, onDestroy } from 'svelte'
  import {
    bodeData, filterParams, comparisons, theme, compareDash, colorMode, colorShuffle, activeTab, plotUnit,
    dataUnit, designForm, designBusy, templateDragging, hoveredFields, lang,
    designError,
  } from '../../stores/app.js'
  import { table, approxName } from '../../lib/i18n.js'
  import { plotColor, compareLine, freqAxis, freqRangeFromParams, TWO_PI } from '../../lib/approx.js'
  import { GD, buildParams, paramsClose, validateForm } from '../../lib/params.js'
  import { gdGeom, gdHandles, gdDragTo, gdCompliance, delayUnit } from '../../lib/gd-template.js'
  import { runDesign } from '../../lib/design-action.js'
  import { formatSI } from '../../lib/si.js'
  import BodePlot from '../BodePlot.svelte'

  const TX = {
    en: {
      outside: 'Outside template',
      delay: 'Delay', delayTitle: 'Largest delay drop below τ₀ up to the reference frequency, vs the allowed γ',
      preview: 'Template preview · designs as soon as the template is valid',
      updating: 'Updating…', lastGood: 'Last valid design',
    },
    es: {
      outside: 'Fuera de la plantilla',
      delay: 'Retardo', delayTitle: 'Mayor caída del retardo por debajo de τ₀ hasta la frecuencia de referencia, frente al γ admitido',
      preview: 'Vista previa de la plantilla · se diseña apenas la plantilla es válida',
      updating: 'Actualizando…', lastGood: 'Último diseño válido',
    },
  }
  $: tx = table(TX, $lang)

  $: axis  = freqAxis($plotUnit)
  $: uf    = $dataUnit === 'rad' ? TWO_PI : 1
  $: toRad = TWO_PI / uf

  // ── Live GD template (E7) from the form ──────────────────────────────────
  $: isGD      = $designForm.filterType === GD
  $: formValid = Object.keys(validateForm($designForm, $lang)).length === 0
  let lastGeom = null
  $: if (isGD && formValid) lastGeom = gdGeom($designForm, uf)
  $: geom    = isGD ? (formValid ? gdGeom($designForm, uf) : lastGeom) : null
  $: handles = gdHandles(geom)
  $: designedGD = $filterParams?.filter_type === GD
  $: comp    = geom && designedGD ? gdCompliance(geom, $bodeData) : null
  $: stale   = isGD && !!$filterParams && formValid && !paramsClose(buildParams($designForm, toRad), $filterParams)

  // Delay axis unit from τ0 (form, else design); upstream used fixed ms.
  $: du = delayUnit(geom?.tau0 ?? $filterParams?.tau0 ?? 1e-3)

  let drag = null      // { h, gx, gy, startForm, moved }
  let dragging = false
  let hoverId = null
  let label = null
  let plot, gd

  // ── Ranges (frozen while dragging) and traces ────────────────────────────
  let xRange = null, yRange = null, traces = []
  const DANGER = { dark: '#f85149', light: '#cf222e' }
  $: if (!dragging) {
    const fr = $bodeData?.freq?.length
      ? { min: $bodeData.freq[0], max: $bodeData.freq[$bodeData.freq.length - 1] }
      : isGD && formValid ? freqRangeFromParams(buildParams($designForm, toRad)) : null
    xRange = geom && fr ? [fr.min * axis.scale, fr.max * axis.scale] : null
    yRange = geom ? [0, geom.tau0 * 1.25 * du.k] : null
  }
  $: if (!dragging) traces = [
    ...($bodeData ? [{
      x: $bodeData.freq.map(f => f * axis.scale),
      y: $bodeData.groupDelay.map(v => v * du.k),
      mode: 'lines',
      name: approxName($filterParams?.approx_type ?? 0, $lang),
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq.map(f => f * axis.scale),
      y: c.bodeData.groupDelay.map(v => v * du.k),
      mode: 'lines',
      name: approxName(c.approxType, $lang),
      line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
    })),
    ...($bodeData && comp?.bad?.some(v => v !== null) ? [{
      x: $bodeData.freq.map(f => f * axis.scale),
      y: comp.bad.map(v => (v == null ? null : v * du.k)),
      mode: 'lines', name: tx.outside,
      line: { color: DANGER[$theme] ?? DANGER.dark, width: 3.5 }, hoverinfo: 'skip',
    }] : []),
  ]

  // ── Shapes ────────────────────────────────────────────────────────────────
  const HANDLE = {
    dark:  { pass: '#3fb950', centre: '#8b949e', bg: '#0d1117' },
    light: { pass: '#1a7f37', centre: '#57606a', bg: '#f6f8fa' },
  }
  function buildShapes(g, hs, ax, th, hovered, activeId, k) {
    if (!g) return []
    const C = HANDLE[th] ?? HANDLE.dark
    const X = v => (v <= 0 ? 1e-30 : v === Infinity ? 1e30 : v * ax.scale)
    const Y = v => (v === -Infinity ? -1e6 : v === Infinity ? 1e6 : v * k)
    const fill = th === 'light' ? 'rgba(255, 204, 203, 0.45)' : 'rgba(248, 81, 73, 0.16)'
    const out = [{
      type: 'rect', xref: 'x', yref: 'y', layer: 'below',
      x0: X(0), x1: X(g.frgHz), y0: Y(-Infinity), y1: Y(g.tauMin), fillcolor: fill, line: { width: 0 },
    }]
    const lit = h => h.id === activeId || hovered.includes(h.xf) || hovered.includes(h.yf)
    for (const h of hs) {
      const on = lit(h), color = C[h.group]
      if (h.kind === 'v') out.push({ type: 'line', xref: 'x', yref: 'y', x0: X(h.x), x1: X(h.x), y0: Y(h.span[0]), y1: Y(h.span[1]), line: { color, width: on ? 3 : 1.5 }, opacity: on ? 1 : 0.8 })
      if (h.kind === 'h' || h.kind === 't') out.push({
        type: 'line', xref: 'x', yref: 'y', x0: X(h.span[0]), x1: X(h.span[1]), y0: Y(h.y), y1: Y(h.y),
        line: { color, width: on ? 3 : 1.5, ...(h.kind === 't' ? { dash: 'dash' } : {}) }, opacity: on ? 1 : 0.8,
      })
    }
    for (const h of hs) {
      if (h.kind !== 'c') continue
      const r = lit(h) ? 6 : 4
      out.push({
        type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
        xanchor: X(h.x), yanchor: Y(h.y), x0: -r, x1: r, y0: -r, y1: r, fillcolor: C[h.group], line: { color: C.bg, width: 1.5 },
      })
    }
    return out
  }
  $: shapes = buildShapes(geom, handles, axis, $theme, $hoveredFields, drag?.h.id ?? hoverId, du.k)

  // ── Hit testing / drag (same model as the magnitude template) ────────────
  const HIT_EDGE = 6, HIT_CORNER = 9
  const axesOf = () => { const fl = gd?._fullLayout; return fl?.xaxis && fl?.yaxis ? { xa: fl.xaxis, ya: fl.yaxis } : null }
  const xPx = (xa, x) => xa._offset + xa.l2p(xa.d2l(x))
  const yPx = (ya, y) => ya._offset + ya.l2p(ya.d2l(y))

  function hitTest(px, py) {
    const ax = axesOf()
    if (!ax || !geom) return null
    const { xa, ya } = ax
    const L = xa._offset, R = L + xa._length, T = ya._offset, B = T + ya._length
    if (px < L - HIT_EDGE || px > R + HIT_EDGE || py < T - HIT_EDGE || py > B + HIT_EDGE) return null
    const cx = v => Math.min(R, Math.max(L, v <= 0 ? -Infinity : v === Infinity ? Infinity : xPx(xa, v * axis.scale)))
    const cy = v => Math.min(B, Math.max(T, v === -Infinity ? Infinity : v === Infinity ? -Infinity : yPx(ya, v * du.k)))
    let best = null, bestScore = Infinity
    for (const h of handles) {
      let score = Infinity
      if (h.kind === 'c') {
        const d = Math.hypot(px - cx(h.x), py - cy(h.y))
        if (d <= HIT_CORNER) score = d - 100
      } else if (h.kind === 'v') {
        const hx = cx(h.x), y0 = cy(h.span[1]), y1 = cy(h.span[0])
        if (Math.abs(px - hx) <= HIT_EDGE && py >= y0 - HIT_EDGE && py <= y1 + HIT_EDGE) score = Math.abs(px - hx)
      } else {
        const hy = cy(h.y), x0 = cx(h.span[0]), x1 = cx(h.span[1])
        if (Math.abs(py - hy) <= HIT_EDGE && px >= x0 - HIT_EDGE && px <= x1 + HIT_EDGE)
          score = Math.abs(py - hy) + (h.kind === 't' ? 20 : 0)
      }
      if (score < bestScore) { bestScore = score; best = h }
    }
    return best
  }

  const CURSOR = { v: 'ew', h: 'ns', t: 'ns', c: 'move' }
  const setCursor = h => { if (!gd) return; if (h) gd.dataset.tplCursor = CURSOR[h.kind]; else delete gd.dataset.tplCursor }
  let ownHover = false
  function setHover(h) {
    hoverId = h?.id ?? null
    if (h) { hoveredFields.set([h.xf, h.yf].filter(Boolean)); ownHover = true }
    else if (ownHover) { hoveredFields.set([]); ownHover = false }
  }
  const rel = e => { const r = gd.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }

  function labelText(h, f) {
    const sym = $dataUnit === 'rad' ? 'ω' : 'f', unit = $dataUnit === 'rad' ? 'rad/s' : 'Hz'
    const out = []
    if (h.xf === 'frg') out.push(`${sym}_rg = ${formatSI(f.frg)} ${unit}`)
    if (h.yf === 'gamma') out.push(`γ = ${f.gamma.toFixed(2)} %`)
    if (h.yf === 'tau0') out.push(`τ₀ = ${formatSI(f.tau0)}s`)
    return out.join(' · ')
  }

  let swallow = false, frame = null, last = null
  function onHoverMove(e) {
    if (drag || e.buttons || !geom) return
    const h = hitTest(...rel(e))
    if ((h?.id ?? null) !== hoverId) setHover(h)
    setCursor(h)
  }
  function onLeave() { if (!drag) { setHover(null); setCursor(null) } }
  function onDown(e) {
    if (e.button !== 0 || drag || !geom) return
    const [px, py] = rel(e)
    const h = hitTest(px, py)
    if (!h) return
    e.stopPropagation(); e.preventDefault(); swallow = true
    const { xa, ya } = axesOf()
    const hx = h.x != null ? xPx(xa, h.x * axis.scale) : px
    const hy = h.y != null ? yPx(ya, h.y * du.k) : py
    drag = { h, gx: px - hx, gy: py - hy, startForm: { ...$designForm }, moved: false }
    dragging = true
    templateDragging.set(true)
    setHover(h); setCursor(h)
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('keydown', onKey)
  }
  function onMouseDown(e) { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault() } }
  function onDragMove(e) { if (!drag) return; last = rel(e); if (frame == null) frame = requestAnimationFrame(apply) }
  function apply() {
    frame = null
    if (!drag || !last) return
    const { xa, ya } = axesOf()
    const [px, py] = last
    const xPlot = xa.l2d(xa.p2l(px - drag.gx - xa._offset))
    const yS = ya.l2d(ya.p2l(py - drag.gy - ya._offset)) / du.k
    const next = gdDragTo(drag.startForm, drag.h, xPlot / axis.scale, yS, uf)
    drag.moved = true
    designForm.set(next)
    label = { x: px + 14, y: py - 30, text: labelText(drag.h, next) }
  }
  function endDrag() {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('keydown', onKey)
    if (frame != null) { cancelAnimationFrame(frame); frame = null }
    const d = drag
    drag = null; dragging = false; label = null; last = null
    templateDragging.set(false)
    return d
  }
  function onDragEnd() { if (frame != null) apply(); const d = endDrag(); if (d?.moved) runDesign() }
  function onKey(e) {
    if (e.key !== 'Escape' || !drag) return
    e.preventDefault()
    const d = endDrag()
    designForm.set(d.startForm)
  }

  onMount(() => {
    gd = plot.plotElement()
    gd.addEventListener('pointerdown', onDown, true)
    gd.addEventListener('mousedown', onMouseDown, true)
    gd.addEventListener('touchstart', onMouseDown, true)
    gd.addEventListener('pointermove', onHoverMove)
    gd.addEventListener('pointerleave', onLeave)
  })
  onDestroy(() => {
    if (drag) endDrag()
    if (ownHover) hoveredFields.set([])
    gd?.removeEventListener('pointerdown', onDown, true)
    gd?.removeEventListener('mousedown', onMouseDown, true)
    gd?.removeEventListener('touchstart', onMouseDown, true)
    gd?.removeEventListener('pointermove', onHoverMove)
    gd?.removeEventListener('pointerleave', onLeave)
  })

  // Unit inside the math: Plotly's MathJax drops plain text after a $…$ title.
  $: yLabel = `$\\tau(${$plotUnit === 'rad' ? '\\omega' : 'f'})\\ [\\mathrm{${du.unit === 'µs' ? '\\mu s' : du.unit}}]$`
  $: uirevision = isGD ? `gd-${$plotUnit}-${du.unit}` : undefined
</script>

<BodePlot
  bind:this={plot}
  {traces}
  {shapes}
  {xRange}
  {yRange}
  {uirevision}
  {yLabel}
  xLabel={axis.xLabel}
  logX={true}
  filename="filtool_groupdelay"
  active={$activeTab === 'groupDelay'}
>
  {#if geom}
    <div class="tpl-overlay">
      {#if comp}
        <span class="chip" class:bad={!comp.ok} title={tx.delayTitle}>
          {tx.delay} {comp.ok ? '✓' : '✗'} <b>−{comp.worstPct.toFixed(2)} %</b> (γ {geom.gamma.toFixed(2)} %){#if !comp.ok}&nbsp;@ {formatSI(comp.at * uf)} {$dataUnit === 'rad' ? 'rad/s' : 'Hz'}{/if}
        </span>
      {/if}
      {#if !designedGD}
        <span class="chip muted">{tx.preview}</span>
      {:else if stale && $designError}
        <!-- The form can't be designed: say the plot is the previous design (error in the tooltip) -->
        <span class="chip bad" title={$designError}>{tx.lastGood}</span>
      {:else if stale && !dragging}
        <!-- Live updates: the form re-designs by itself a moment after each edit -->
        <span class="chip muted">{tx.updating}</span>
      {/if}
    </div>
    {#if label}<div class="drag-label" style="left: {label.x}px; top: {label.y}px">{label.text}</div>{/if}
  {/if}
</BodePlot>

<style>
  .tpl-overlay {
    position: absolute; top: 42px; left: 72px; z-index: 5;
    display: flex; flex-wrap: wrap; gap: 0.3rem; pointer-events: none; max-width: calc(100% - 240px);
  }
  .chip {
    font-size: 0.74rem; line-height: 1.2; padding: 0.18rem 0.5rem; border-radius: 999px; white-space: nowrap;
    border: 1px solid color-mix(in srgb, var(--success) 45%, var(--border));
    background: color-mix(in srgb, var(--success) 12%, var(--surface)); color: var(--text);
  }
  .chip b { font-weight: 600; font-family: ui-monospace, 'SF Mono', Consolas, monospace; }
  .chip.bad { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); background: color-mix(in srgb, var(--danger) 14%, var(--surface)); }
  .chip.muted { border-color: var(--border); background: var(--surface); color: var(--text-dim); }
  .drag-label {
    position: absolute; pointer-events: none; z-index: 6;
    font-size: 0.76rem; font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    padding: 0.2rem 0.45rem; border-radius: 4px; white-space: nowrap;
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
</style>
