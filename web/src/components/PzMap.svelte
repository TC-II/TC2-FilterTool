<script>
  // Reusable s-plane (pole-zero) plot.
  //
  // groups: [{ roots: [{ re, im, ref?, label? }], symbol: 'x' | 'circle-open' | …,
  //            color, size, name, opacity?, lineWidth?, dash? }]
  //   roots in rad/s; `scale` converts to the display unit. Roots with a `ref`
  //   are interactive: hover / click / drag / wheel events carry it.
  //
  // Events (re / im in rad/s):
  //   hover {ref|null} · click {ref} · dragstart {ref} · drag {ref, re, im, snapIm} ·
  //   dragend {ref} · wheel {ref, dir: ±1}
  import { onMount, onDestroy, createEventDispatcher } from 'svelte'
  import Plotly from 'plotly.js-dist'
  import { theme, showLegend, plotCursor, lang } from '../stores/app.js'
  import { beginPlotWork } from '../lib/plot-activity.js'
  import { plotlyLocale } from './BodePlot.svelte'

  export let groups = []
  export let scale = 1
  export let xLabel = 'Re(s)'
  export let yLabel = 'Im(s)'
  export let active = true
  export let filename = 'filtool_pz'
  /** Mini-map: tighter margins, no legend, no mode bar. */
  export let compact = false
  export let unitCircle = true
  /** (ref) => boolean — roots that can be dragged. */
  export let canDrag = null
  /** (ref) => boolean — roots that react to the wheel. */
  export let canWheel = null
  /** (ref) => whether a click on that root means something (pointer cursor, no zoom box). Default: any root. */
  export let canClick = null
  /**
   * Keep the axes where the first render put them: later changes to `groups`
   * (roots moved / re-tuned) don't re-fit the view. Reset by `resetKey`.
   */
  export let stickyRange = false
  /** Changing this resets zoom / frozen ranges (e.g. a new design). */
  export let resetKey = null
  /**
   * Live markers drawn on a canvas over the plot, synchronously on every change
   * (drag previews): [{ re, im, symbol: 'x' | 'o', color, size }] in rad/s, or null.
   */
  export let overlayMarkers = null
  /**
   * Text labels pinned to s-plane points: [{ re, im, text, color?, font?, xshift?, yshift? }]
   * in rad/s (e.g. root multiplicities).
   */
  export let annotations = []

  const dispatch = createEventDispatcher()
  let overlay
  let overlayNo = 0

  let container
  let initialized = false
  let destroyed = false
  let resizeObserver
  let refreshTimer = null
  let refreshDone = null   // plot-activity token of the scheduled refresh
  let refreshToken = 0
  let wasActive = active
  let frozen = null      // { x: [a, b], y: [a, b] } while / after a drag, until resetKey changes

  $: resetKey, scale, (frozen = null)

  /** Optional color overrides (keys of C, plus legend / legendBorder), e.g. the game mode's palette. */
  export let palette = null

  $: C = {
    ...($theme === 'light'
      ? { unit: '#d0d7de', grid: '#d8dee4', bg: '#f6f8fa', axis: '#afb8c1', zero: '#afb8c1', text: '#1f2328', legend: '#ffffff', legendBorder: '#d0d7de' }
      : { unit: '#30363d', grid: '#21262d', bg: '#0d1117', axis: '#484f58', zero: '#52565c', text: '#e6edf3', legend: '#161b22', legendBorder: '#30363d' }),
    ...(palette ?? {}),
  }

  function buildTraces() {
    const out = []
    if (unitCircle) {
      const θ = Array.from({ length: 361 }, (_, i) => (i * Math.PI) / 180)
      out.push({
        x: θ.map(t => Math.cos(t) * scale), y: θ.map(t => Math.sin(t) * scale),
        mode: 'lines', line: { color: C.unit, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false,
      })
    }
    for (const g of groups) {
      if (!g.roots?.length) continue
      const open = String(g.symbol).includes('open')
      out.push({
        x: g.roots.map(r => r.re * scale), y: g.roots.map(r => r.im * scale),
        mode: 'markers', name: g.name, showlegend: g.showlegend ?? true,
        opacity: g.opacity ?? 1,
        marker: {
          symbol: g.symbol, size: g.size ?? 10, color: g.color,
          line: { width: g.lineWidth ?? 2, ...(open ? {} : { color: g.color }) },
        },
        hovertemplate: g.roots.map(r => `${r.label ?? ''}<extra>${g.name}</extra>`),
      })
    }
    return out
  }

  function makeLayout() {
    const baseFont = { color: C.text, size: compact ? 11 : 12, family: 'system-ui, sans-serif' }
    const tickFont = { color: C.text, size: compact ? 10 : 11, family: 'system-ui, sans-serif' }
    const ax = (title, range) => ({
      title: compact ? undefined : { text: title, standoff: 8, font: baseFont },
      gridcolor: C.grid, linecolor: C.axis, tickcolor: C.axis, tickfont: tickFont,
      zeroline: true, zerolinecolor: C.zero, zerolinewidth: 1.5,
      ...(range ? { range, autorange: false } : { autorange: true }),
    })
    return {
      paper_bgcolor: C.bg, plot_bgcolor: C.bg,
      font: baseFont,
      showlegend: !compact && $showLegend,
      margin: compact ? { t: 8, b: 28, l: 44, r: 8 } : { t: 36, b: 56, l: 64, r: 24 },
      uirevision: resetKey ?? 'pz',
      legend: {
        bgcolor: C.legend,
        bordercolor: C.legendBorder,
        borderwidth: 1, font: { size: 11, family: 'system-ui, sans-serif' },
        x: 1, xanchor: 'right', y: 0.98, yanchor: 'top', tracegroupgap: 4,
      },
      hovermode: $plotCursor ? 'closest' : false,
      annotations: (annotations ?? []).map(a => ({
        x: a.re * scale, y: a.im * scale, xref: 'x', yref: 'y',
        text: a.text, showarrow: false,
        xshift: a.xshift ?? 12, yshift: a.yshift ?? 12,
        font: { color: a.color ?? C.text, size: 13, ...(a.font ?? {}) },
      })),
      xaxis: { ...ax(xLabel, frozen?.x), scaleanchor: 'y', scaleratio: 1 },
      yaxis: ax(yLabel, frozen?.y),
      modebar: {
        color:       $theme === 'light' ? '#57606a' : '#7d8590',
        activecolor: $theme === 'light' ? '#0969da' : '#58a6ff',
        bgcolor:     $theme === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(22,27,34,0.85)',
      },
    }
  }

  const cfg = () => ({
    locale: plotlyLocale($lang),
    responsive: true, displaylogo: false, displayModeBar: !compact, staticPlot: compact,
    toImageButtonOptions: { format: 'svg', filename },
  })

  async function awaitMathJax() {
    try { const mj = globalThis.MathJax; if (mj?.startup?.promise) await mj.startup.promise } catch { /* optional */ }
  }

  let staleWhileHidden = false

  async function refresh() {
    if (initialized && !active) { staleWhileHidden = true; return }
    if (!initialized || destroyed || !container || !active) return
    const token = ++refreshToken
    await awaitMathJax()
    if (token !== refreshToken || destroyed || !container || !active) return
    await Plotly.react(container, buildTraces(), makeLayout(), cfg())
    if (token !== refreshToken || destroyed) return
    if (stickyRange && !frozen && groups.some(g => g.roots?.length)) {
      const ax = axes()
      if (ax) frozen = { x: ax.xa.range.slice(), y: ax.ya.range.slice() }
    }
    dispatch('rendered')
  }

  // ── Live overlay ──────────────────────────────────────────────────────────
  $: drawOverlay(overlayMarkers, scale)

  function drawOverlay(list) {
    if (!overlay || !container) return
    const dpr = window.devicePixelRatio || 1, w = container.clientWidth, h = container.clientHeight
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr)
      overlay.style.width = `${w}px`; overlay.style.height = `${h}px`
    }
    const ctx = overlay.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const ax = axes()
    if (!list?.length || !ax) { overlay.dataset.frame = ''; return }
    const { xa, ya } = ax
    ctx.save()
    ctx.beginPath(); ctx.rect(xa._offset, ya._offset, xa._length, ya._length); ctx.clip()
    for (const m of list) {
      const x = xa._offset + xa.l2p(m.re * scale), y = ya._offset + ya.l2p(m.im * scale), r = (m.size ?? 11) / 2
      ctx.strokeStyle = m.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
      ctx.beginPath()
      if (m.symbol === 'x') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r) }
      else ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.stroke()
    }
    ctx.restore()
    overlay.dataset.frame = String(++overlayNo)
  }

  // Throttle, not debounce: during a drag changes arrive every frame, and a
  // restarting timer would only redraw once the motion stops.
  function schedule(ms = 16) {
    if (refreshTimer != null) return
    const done = refreshDone = beginPlotWork()
    refreshTimer = setTimeout(() => { refreshTimer = null; refreshDone = null; refresh().finally(done) }, ms)
  }

  $: if (initialized) schedule(), [groups, annotations, scale, C, $showLegend, $plotCursor, frozen, xLabel, yLabel, resetKey, $lang]

  $: if (initialized && active && !wasActive) {
    wasActive = true
    // Stale data: redraw in the same update that shows the tab (no stale first frame).
    if (staleWhileHidden) { staleWhileHidden = false; refresh() }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (container) { Plotly.Plots.resize(container); schedule(0) } }))
  } else if (!active) {
    wasActive = false
  }

  // ── Interaction: our own hit test so it works with Plotly hover off ───────
  const HIT = 9
  let hoverRef = null
  let drag = null           // { ref, moved, x0, y0 }
  let press = null          // non-draggable press, for click detection
  let swallow = false

  function axes() {
    const fl = container?._fullLayout
    return fl?.xaxis && fl?.yaxis ? { xa: fl.xaxis, ya: fl.yaxis } : null
  }
  function rel(e) {
    const r = container.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  function hit(px, py) {
    const ax = axes()
    if (!ax) return null
    const { xa, ya } = ax
    let best = null, bestD = HIT
    for (const g of groups) {
      for (const r of g.roots ?? []) {
        if (r.ref == null) continue
        const x = xa._offset + xa.l2p(r.re * scale), y = ya._offset + ya.l2p(r.im * scale)
        const d = Math.hypot(px - x, py - y)
        if (d <= bestD) { bestD = d; best = r }
      }
    }
    return best
  }
  function toData(px, py) {
    const { xa, ya } = axes()
    return [xa.p2l(px - xa._offset) / scale, ya.p2l(py - ya._offset) / scale]
  }
  /** Data units (rad/s) spanned by `px` pixels vertically. */
  function pxToIm(px) {
    const { ya } = axes()
    return Math.abs(ya.p2l(0) - ya.p2l(px)) / scale
  }

  const clickable = ref => (canClick ? canClick(ref) : true)

  function setHover(ref) {
    if (ref === hoverRef) return
    hoverRef = ref
    dispatch('hover', { ref })
    if (container) container.style.cursor = ''
    const drag = container?.querySelector('.nsewdrag')
    if (drag) drag.style.cursor = ref != null ? (canDrag?.(ref) ? 'grab' : clickable(ref) ? 'pointer' : '') : ''
  }

  function onMove(e) {
    if (drag || e.buttons) return
    const [px, py] = rel(e)
    setHover(hit(px, py)?.ref ?? null)
  }
  function onLeave() { if (!drag) setHover(null) }

  function onDown(e) {
    if (e.button !== 0) return
    const [px, py] = rel(e)
    const r = hit(px, py)
    if (!r) return
    if (canDrag?.(r.ref)) {
      e.stopPropagation(); e.preventDefault(); swallow = true
      const ax = axes()
      frozen = { x: ax.xa.range.slice(), y: ax.ya.range.slice() }
      drag = { ref: r.ref, moved: false, x0: px, y0: py }
      dispatch('dragstart', { ref: r.ref })
      window.addEventListener('pointermove', onDragMove)
      window.addEventListener('pointerup', onDragEnd)
    } else if (clickable(r.ref)) {
      // A click on a root selects it: keep Plotly from starting a zoom box
      e.stopPropagation(); e.preventDefault(); swallow = true
      press = { ref: r.ref, x0: px, y0: py }
      window.addEventListener('pointerup', onPressEnd)
    }
  }
  function onMouseDown(e) {
    if (!swallow) return
    swallow = false
    e.stopPropagation(); e.preventDefault()
  }
  function onDragMove(e) {
    if (!drag) return
    const [px, py] = rel(e)
    if (!drag.moved && Math.hypot(px - drag.x0, py - drag.y0) < 3) return
    drag.moved = true
    const [re, im] = toData(px, py)
    dispatch('drag', { ref: drag.ref, re, im, snapIm: pxToIm(6) })
  }
  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    const d = drag
    drag = null
    if (!d) return
    if (d.moved) dispatch('dragend', { ref: d.ref })
    else dispatch('click', { ref: d.ref })
  }
  function onPressEnd(e) {
    window.removeEventListener('pointerup', onPressEnd)
    const p = press
    press = null
    if (!p) return
    const [px, py] = rel(e)
    if (Math.hypot(px - p.x0, py - p.y0) < 4) dispatch('click', { ref: p.ref })
  }
  function onWheel(e) {
    const [px, py] = rel(e)
    const r = hit(px, py)
    if (!r || !canWheel?.(r.ref)) return
    e.preventDefault(); e.stopPropagation()
    dispatch('wheel', { ref: r.ref, dir: e.deltaY < 0 ? 1 : -1 })
  }

  onMount(() => {
    Plotly.newPlot(container, buildTraces(), makeLayout(), cfg())
    initialized = true
    resizeObserver = new ResizeObserver(() => { if (initialized && !destroyed && active && container) Plotly.Plots.resize(container) })
    resizeObserver.observe(container)
    container.addEventListener('pointerdown', onDown, true)
    container.addEventListener('mousedown', onMouseDown, true)
    container.addEventListener('touchstart', onMouseDown, true)
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', onLeave)
    container.addEventListener('wheel', onWheel, { capture: true, passive: false })
    if (active) schedule(0)
  })

  onDestroy(() => {
    destroyed = true
    initialized = false
    if (refreshTimer != null) clearTimeout(refreshTimer)
    refreshDone?.()
    refreshToken++
    resizeObserver?.disconnect()
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointerup', onPressEnd)
    if (container) Plotly.purge(container)
  })

  export function plotElement() { return container }
</script>

<div class="pz-wrap">
  <div class="pz-map" bind:this={container}></div>
  <canvas class="pz-overlay" bind:this={overlay} aria-hidden="true"></canvas>
</div>

<style>
  .pz-wrap { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .pz-map { width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .pz-overlay { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 4; }
</style>
