<script>
  import { onMount, onDestroy } from 'svelte'
  import {
    bodeData, filterParams, comparisons, theme, compareDash, colorMode, colorShuffle, activeTab,
    plotUnit, dataUnit, designForm, hoveredFields, designBusy, templateDragging, liveAdjusting,
  } from '../../stores/app.js'
  import { APPROX_NAMES, plotColor, compareLine, freqAxis, freqRangeFromParams, TWO_PI } from '../../lib/approx.js'
  import { GD, DEFAULT_FORM, buildParams, formFromParams, paramsClose, validateForm } from '../../lib/params.js'
  import { templateGeom, templateHandles, dragTo, compliance, transitionNear, symmetrizedGeom } from '../../lib/template.js'
  import { runDesign, liveDenorm, denormPreview } from '../../lib/design-action.js'
  import { formatSI } from '../../lib/si.js'
  import BodePlot from '../BodePlot.svelte'

  export let showTemplate = true

  function toDb(v) {
    if (!(v > 0)) return null
    const db = 20 * Math.log10(v)
    return Number.isFinite(db) ? db : null
  }

  $: axis   = freqAxis($plotUnit)
  $: uf     = $dataUnit === 'rad' ? TWO_PI : 1
  $: toRad  = TWO_PI / uf
  $: tabId  = showTemplate ? 'template' : 'magnitude'

  // ── Live template (from the form, not the last design) ───────────────────
  $: formValid = Object.keys(validateForm($designForm)).length === 0
  let lastGeom = null
  $: if (showTemplate && formValid) lastGeom = templateGeom($designForm, uf)
  // An invalid form keeps showing the last valid template.
  $: geom    = showTemplate ? (formValid ? templateGeom($designForm, uf) : lastGeom) : null
  $: handles = templateHandles(geom)
  // Edges mode: the geometrically symmetric template the engine actually designs to
  $: symGeom = showTemplate ? symmetrizedGeom(geom) : null
  $: stale   = showTemplate && !!$filterParams && formValid &&
               !paramsClose(buildParams($designForm, toRad), $filterParams)
  // Compliance of the published design (red trace) and of what's on screen
  // (chips): during a live denorm preview the chips follow the preview.
  $: compDesign = showTemplate ? compliance(geom, $bodeData) : null
  $: comp       = showTemplate && previewBode ? compliance(geom, previewBode) : compDesign

  // ── Drag state ───────────────────────────────────────────────────────────
  /**
   * Template handle drag: { kind: 'handle', h, gx, gy, startForm, moved }
   * Curve drag (denorm): { kind: 'curve', startDenorm, grabLog, gap, levelDb, d, moved }
   */
  let drag = null
  let dragging = false      // handle drag: freezes traces and axes
  let curveGuide = null     // { passHz, stopHz, levelDb, d } shown while dragging the curve
  let hoverId = null
  let label = null          // { x, y, text } floating value label
  let plot                  // BodePlot instance

  // ── Axis ranges, frozen while dragging so the plot doesn't move under the cursor
  let xRange = null, yRange = null
  $: if (!dragging && !previewing) {
    const fr = $bodeData?.freq?.length
      ? { min: $bodeData.freq[0], max: $bodeData.freq[$bodeData.freq.length - 1] }
      : freqRangeFromParams(formValid ? buildParams($designForm, toRad) : $filterParams)
    xRange = showTemplate ? [fr.min * axis.scale, fr.max * axis.scale] : null
    const f = formValid ? $designForm : null
    yRange = showTemplate && f && f.filterType !== GD ? [f.gainDb - 2 * f.aaDb, f.gainDb] : null
  }

  // ── Traces (untouched while dragging: only shapes move) ──────────────────
  const DANGER = { dark: '#f85149', light: '#cf222e' }
  let traces = []
  // Frozen while dragging a handle or previewing denorm; entering a preview
  // re-renders once with the published curve ghosted.
  let ghosted = false
  $: if (!dragging && !previewing) { ghosted = false; traces = buildTraces(false, $bodeData, $comparisons, compDesign, axis, $theme, $colorMode, $colorShuffle, $compareDash, $filterParams) }
  $: if (previewing && !ghosted) { ghosted = true; traces = buildTraces(true) }

  function buildTraces(ghost) { return [
    ...($bodeData ? [{
      x: $bodeData.freq.map(f => f * axis.scale),
      y: $bodeData.magnitude.map(toDb),
      mode: 'lines',
      name: APPROX_NAMES[$filterParams?.approx_type ?? 0],
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
      opacity: ghost ? 0.25 : 1,
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq.map(f => f * axis.scale),
      y: c.bodeData.magnitude.map(toDb),
      mode: 'lines',
      name: APPROX_NAMES[c.approxType],
      line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
    })),
    ...($bodeData && !ghost && compDesign?.bad?.some(v => v !== null) ? [{
      x: $bodeData.freq.map(f => f * axis.scale),
      y: compDesign.bad,
      mode: 'lines',
      name: 'Outside template',
      line: { color: DANGER[$theme] ?? DANGER.dark, width: 3.5 },
      hoverinfo: 'skip',
    }] : []),
  ] }

  // ── Live denorm preview (canvas) ─────────────────────────────────────────
  // design-action publishes each step's poles / zeros; |H| is evaluated here
  // at pixel resolution and drawn on a canvas over the frozen, ghosted plot.
  let overlay
  let previewBode = null        // { freq, magnitude } of the preview, for the chips
  let holdOverlay = false       // preview ended: keep the canvas until Plotly redraws
  let ovFrame = null, ovNo = 0
  $: isActive = $activeTab === tabId
  $: previewing = !!$denormPreview && isActive && $denormPreview.params.filter_type !== GD
  $: previewBode = previewing ? previewResponse($denormPreview.result) : null
  // Draw as soon as a preview step arrives (no extra frame of latency).
  $: if (previewing && (previewBode || $theme)) { holdOverlay = true; drawOverlay() }

  /** |H| of a design result on a log grid spanning the visible x range, plus its jω-axis zeros. */
  function previewResponse(r) {
    const fl = gd?._fullLayout
    if (!fl?.xaxis || !r?.num?.length) return null
    const xa = fl.xaxis
    const [l0, l1] = xa.range            // log10 of plot units
    const n = Math.max(200, Math.round(xa._length * 1.5))
    const toHz = l => 10 ** l / axis.scale
    const freq = Array.from({ length: n + 1 }, (_, i) => toHz(l0 + ((l1 - l0) * i) / n))
    for (const [re, im] of r.zeros) {
      const f = Math.abs(im) / TWO_PI
      if (Math.abs(re) < 1e-9 * Math.max(1, Math.abs(im)) && f > freq[0] && f < freq[n]) freq.push(f)
    }
    freq.sort((a, b) => a - b)
    const k = Math.abs(r.num[0])        // num = k·Π(s − z)
    const magnitude = freq.map(fHz => {
      const w = TWO_PI * fHz
      let m = k
      for (const [re, im] of r.zeros) m *= Math.hypot(re, w - im)
      for (const [re, im] of r.poles) m /= Math.hypot(re, w - im)
      return m
    })
    return { freq, magnitude }
  }

  function scheduleOverlay() { if (ovFrame == null) ovFrame = requestAnimationFrame(drawOverlay) }

  function drawOverlay() {
    ovFrame = null
    if (!overlay || !gd) return
    const dpr = window.devicePixelRatio || 1, w = gd.clientWidth, h = gd.clientHeight
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr)
      overlay.style.width = `${w}px`; overlay.style.height = `${h}px`
    }
    const ctx = overlay.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const b = previewBode, fl = gd._fullLayout
    if (!b || !fl?.xaxis) { overlay.dataset.frame = ''; return }
    const xa = fl.xaxis, ya = fl.yaxis
    const X = f => xa._offset + xa.l2p(xa.d2l(f * axis.scale)), Y = d => ya._offset + ya.l2p(d)
    const stroke = (ys, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < b.freq.length; i++) {
        const v = ys[i]
        if (v == null || !Number.isFinite(v)) { pen = false; continue }
        const x = X(b.freq[i]), y = Y(v)
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true }
      }
      ctx.stroke()
    }
    ctx.save()
    ctx.beginPath(); ctx.rect(xa._offset, ya._offset, xa._length, ya._length); ctx.clip()
    ctx.lineJoin = 'round'
    stroke(b.magnitude.map(m => (m > 0 ? 20 * Math.log10(m) : null)), plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), 2)
    if (comp?.bad?.some(v => v !== null)) stroke(comp.bad, DANGER[$theme] ?? DANGER.dark, 3.5)
    ctx.restore()
    overlay.dataset.frame = String(++ovNo)
  }

  // After the preview, clear the canvas only once Plotly has drawn the real curve.
  function onRendered() {
    if (holdOverlay && !previewing) { holdOverlay = false; previewBode = null; scheduleOverlay() }
  }

  // ── Template shapes ──────────────────────────────────────────────────────
  const HANDLE = {
    dark:  { pass: '#3fb950', stop: '#d29922', centre: '#8b949e', bg: '#0d1117' },
    light: { pass: '#1a7f37', stop: '#9a6700', centre: '#57606a', bg: '#f6f8fa' },
  }
  const X_OPEN = [1e-30, 1e30], Y_OPEN = [-1e4, 1e4]

  const SYM_LINE = { dark: '#8b949e', light: '#6e7781' }

  function buildShapes(g, hs, ax, th, hovered, activeId, sym) {
    if (!g) return []
    const C = HANDLE[th] ?? HANDLE.dark
    const X = v => (v <= 0 ? X_OPEN[0] : v === Infinity ? X_OPEN[1] : v * ax.scale)
    const Y = v => (v === -Infinity ? Y_OPEN[0] : v === Infinity ? Y_OPEN[1] : v)
    const fill = th === 'light' ? 'rgba(255, 204, 203, 0.45)' : 'rgba(248, 81, 73, 0.16)'
    const rect = (x0, x1, y0, y1) => ({
      type: 'rect', xref: 'x', yref: 'y', layer: 'below',
      x0: X(x0), x1: X(x1), y0: Y(y0), y1: Y(y1), fillcolor: fill, line: { width: 0 },
    })
    const out = [
      ...g.pass.map(([a, b]) => rect(a, b, -Infinity, g.passDb)),
      ...g.stop.map(([a, b]) => rect(a, b, g.stopDb, Infinity)),
    ]
    // Symmetrized template (what the engine designs to): only the edges that
    // differ, as a very thin dotted grey line: the moved edge plus the step at its level.
    if (sym) {
      const line = { color: SYM_LINE[th] ?? SYM_LINE.dark, width: 1, dash: 'dot' }
      const seg = (x0, x1, y0, y1) => ({ type: 'line', xref: 'x', yref: 'y', layer: 'above', x0: X(x0), x1: X(x1), y0: Y(y0), y1: Y(y1), line })
      for (const c of sym.changed) {
        const level = c.group === 'stop' ? g.stopDb : g.passDb
        const [yA, yB] = c.group === 'stop' ? [level, Infinity] : [-Infinity, level]
        out.push(seg(c.to, c.to, yA, yB))
        out.push(seg(Math.min(c.from, c.to), Math.max(c.from, c.to), level, level))
      }
    }
    const lit = h => h.id === activeId || hovered.includes(h.xf) || hovered.includes(h.yf)
    for (const h of hs) {
      const color = C[h.group], on = lit(h)
      if (h.kind === 'v' || h.kind === 'f0') {
        out.push({
          type: 'line', xref: 'x', yref: 'y', x0: X(h.x), x1: X(h.x), y0: Y(h.span[0]), y1: Y(h.span[1]),
          line: { color, width: on ? 3 : 1.5, ...(h.kind === 'f0' ? { dash: 'dash' } : {}) },
          opacity: on ? 1 : 0.8,
        })
      } else if (h.kind === 'h') {
        out.push({
          type: 'line', xref: 'x', yref: 'y', x0: X(h.span[0]), x1: X(h.span[1]), y0: h.y, y1: h.y,
          line: { color, width: on ? 3 : 1.5 }, opacity: on ? 1 : 0.8,
        })
      }
    }
    // Corner grips on top of the edges
    for (const h of hs) {
      if (h.kind !== 'c') continue
      const r = lit(h) ? 6 : 4
      out.push({
        type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
        xanchor: X(h.x), yanchor: h.y, x0: -r, x1: r, y0: -r, y1: r,
        fillcolor: C[h.group], line: { color: C.bg, width: 1.5 },
      })
    }
    return out
  }

  // Denorm guide while dragging the curve: the transition band (0 % at the
  // passband edge, 100 % at the stopband edge) with a dot at the current value.
  const ACCENT = { dark: '#58a6ff', light: '#0969da' }
  function guideShapes(gd, ax, th) {
    if (!gd) return []
    const C = HANDLE[th] ?? HANDLE.dark
    const lp = Math.log10(gd.passHz), ls = Math.log10(gd.stopHz)
    const xd = 10 ** (lp + ((ls - lp) * gd.d) / 100)
    const dot = (x, r, color) => ({
      type: 'circle', xref: 'x', yref: 'y', xsizemode: 'pixel', ysizemode: 'pixel',
      xanchor: x * ax.scale, yanchor: gd.levelDb, x0: -r, x1: r, y0: -r, y1: r,
      fillcolor: color, line: { color: C.bg, width: 1.5 },
    })
    return [
      {
        type: 'line', xref: 'x', yref: 'y', x0: gd.passHz * ax.scale, x1: gd.stopHz * ax.scale,
        y0: gd.levelDb, y1: gd.levelDb, line: { color: C.centre, width: 2, dash: 'dot' },
      },
      dot(gd.passHz, 3.5, C.pass),
      dot(gd.stopHz, 3.5, C.stop),
      dot(xd, 6, ACCENT[th] ?? ACCENT.dark),
    ]
  }

  $: shapes = showTemplate
    ? [...buildShapes(geom, handles, axis, $theme, $hoveredFields, drag?.h?.id ?? hoverId, symGeom), ...guideShapes(curveGuide, axis, $theme)]
    : []

  // ── Pixel geometry / hit testing ─────────────────────────────────────────
  const HIT_EDGE = 6, HIT_CORNER = 9

  function axesOf(gd) {
    const fl = gd?._fullLayout
    return fl?.xaxis && fl?.yaxis ? { xa: fl.xaxis, ya: fl.yaxis } : null
  }
  // Plot-unit x / dB y ↔ pixels relative to the graph div. On log axes d2l is log10.
  const xPx = (xa, x) => xa._offset + xa.l2p(xa.d2l(x))
  const yPx = (ya, y) => ya._offset + ya.l2p(ya.d2l(y))

  function hitTest(gd, px, py) {
    const ax = axesOf(gd)
    if (!ax) return null
    const { xa, ya } = ax
    const L = xa._offset, R = L + xa._length, T = ya._offset, B = T + ya._length
    if (px < L - HIT_EDGE || px > R + HIT_EDGE || py < T - HIT_EDGE || py > B + HIT_EDGE) return null
    const clampX = v => Math.min(R, Math.max(L, v)), clampY = v => Math.min(B, Math.max(T, v))
    const hxOf = x => clampX(x <= 0 ? -Infinity : x === Infinity ? Infinity : xPx(xa, x * axis.scale))
    const hyOf = y => clampY(y === -Infinity ? Infinity : y === Infinity ? -Infinity : yPx(ya, y))
    let best = null, bestScore = Infinity
    for (const h of handles) {
      let score = Infinity
      if (h.kind === 'c') {
        const d = Math.hypot(px - hxOf(h.x), py - hyOf(h.y))
        if (d <= HIT_CORNER) score = d - 100
      } else if (h.kind === 'v' || h.kind === 'f0') {
        const hx = hxOf(h.x)
        const [y0, y1] = [hyOf(h.span[1]), hyOf(h.span[0])]   // pixel y grows downward
        if (Math.abs(px - hx) <= HIT_EDGE && py >= y0 - HIT_EDGE && py <= y1 + HIT_EDGE)
          score = Math.abs(px - hx) + (h.kind === 'f0' ? 50 : 0)
      } else if (h.kind === 'h') {
        const hy = hyOf(h.y)
        const [x0, x1] = [hxOf(h.span[0]), hxOf(h.span[1])]
        if (Math.abs(py - hy) <= HIT_EDGE && px >= x0 - HIT_EDGE && px <= x1 + HIT_EDGE) score = Math.abs(py - hy)
      }
      if (score < bestScore) { bestScore = score; best = h }
    }
    return best
  }

  const CURSOR = { v: 'ew', f0: 'ew', h: 'ns', c: 'move', curve: 'col' }
  function setCursor(gd, h) {
    if (h) gd.dataset.tplCursor = CURSOR[h.kind]
    else delete gd.dataset.tplCursor
  }

  // ── Curve hit test (drag the designed |H| sideways → denorm) ─────────────
  $: curveDb = $bodeData?.magnitude?.map(toDb) ?? null
  const HIT_CURVE = 6

  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m }
    return lo
  }

  function curveHit(px, py) {
    if (!showTemplate || !curveDb || !$filterParams || $filterParams.filter_type === GD) return false
    const ax = axesOf(gd)
    if (!ax) return false
    const { xa, ya } = ax
    if (px < xa._offset || px > xa._offset + xa._length || py < ya._offset || py > ya._offset + ya._length) return false
    const f = $bodeData.freq
    const fAt = p => xa.l2d(xa.p2l(p - xa._offset)) / axis.scale
    const i0 = Math.max(0, lowerBound(f, fAt(px - 10)) - 1)
    const i1 = Math.min(f.length - 1, lowerBound(f, fAt(px + 10)) + 1)
    let best = Infinity
    for (let i = i0; i < i1; i++) {
      if (curveDb[i] == null || curveDb[i + 1] == null) continue
      const x0 = xPx(xa, f[i] * axis.scale), y0 = yPx(ya, curveDb[i])
      const x1 = xPx(xa, f[i + 1] * axis.scale), y1 = yPx(ya, curveDb[i + 1])
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy
      const t = L2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)) : 0
      best = Math.min(best, Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)))
    }
    return best <= HIT_CURVE
  }

  const pointerHz = px => {
    const { xa } = axesOf(gd)
    return xa.l2d(xa.p2l(px - xa._offset)) / axis.scale
  }

  const fieldsOf = h => [h.xf, h.yf].filter(Boolean)
  let ownHover = false
  function setHover(h) {
    hoverId = h?.id ?? null
    if (h) { hoveredFields.set(fieldsOf(h)); ownHover = true }
    else if (ownHover) { hoveredFields.set([]); ownHover = false }
  }

  // ── Floating label ───────────────────────────────────────────────────────
  const SUB = { 1: '₁', 2: '₂' }
  function fieldLabel(field, sym) {
    if (field === 'apDb') return 'Ap'
    if (field === 'aaDb') return 'Aa'
    if (field === 'f0') return `${sym}₀`
    if (field === 'bwp') return 'BWp'
    if (field === 'bwa') return 'BWa'
    const m = field.match(/^f([pa])(\d)?$/)
    return m ? `${sym}${m[1]}${SUB[m[2]] ?? ''}` : field
  }
  function labelText(h, f) {
    const sym = $dataUnit === 'rad' ? 'ω' : 'f'
    const unit = $dataUnit === 'rad' ? 'rad/s' : 'Hz'
    const parts = []
    if (h.xf) parts.push(`${fieldLabel(h.xf, sym)} = ${formatSI(f[h.xf])} ${unit}`)
    if (h.yf) parts.push(`${fieldLabel(h.yf, sym)} = ${f[h.yf].toFixed(2)} dB`)
    return parts.join(' · ')
  }

  // ── Pointer handling ─────────────────────────────────────────────────────
  let gd = null
  let swallowMouse = false
  let moveFrame = null, lastMove = null

  function rel(e) {
    const r = gd.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  function onHoverMove(e) {
    if (drag || !showTemplate || e.buttons) return
    const [px, py] = rel(e)
    const h = hitTest(gd, px, py)
    if ((h?.id ?? null) !== hoverId) setHover(h)
    setCursor(gd, h ?? (curveHit(px, py) ? { kind: 'curve' } : null))
  }

  function onLeave() {
    if (drag) return
    setHover(null)
    setCursor(gd, null)
  }

  function onDown(e) {
    if (!showTemplate || e.button !== 0 || drag) return
    const [px, py] = rel(e)
    const h = hitTest(gd, px, py)
    if (h) {
      const { xa, ya } = axesOf(gd)
      const hx = h.x != null ? xPx(xa, h.x * axis.scale) : px
      const hy = h.y != null ? yPx(ya, h.y) : py
      drag = { kind: 'handle', h, gx: px - hx, gy: py - hy, startForm: { ...$designForm }, moved: false }
      dragging = true
      templateDragging.set(true)
      setHover(h)
      setCursor(gd, h)
    } else if (curveHit(px, py) && liveDenorm.start()) {
      // Geometry of the design being adjusted (not the live form, which may have pending edits).
      const base = liveDenorm.base
      const g = templateGeom(formFromParams(base, 1, DEFAULT_FORM), TWO_PI)
      const grabHz = pointerHz(px)
      const d = base.denorm ?? 0
      drag = {
        kind: 'curve', startDenorm: d, grabLog: Math.log10(grabHz),
        gap: transitionNear(g, grabHz), levelDb: (g.passDb + g.stopDb) / 2, d, moved: false,
      }
      curveGuide = { ...drag.gap, levelDb: drag.levelDb, d }
      setCursor(gd, { kind: 'curve' })
    } else {
      return
    }
    // Ours: keep Plotly from starting a zoom / pan.
    e.stopPropagation()
    e.preventDefault()
    swallowMouse = true
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragCancel)
    window.addEventListener('keydown', onKey)
  }

  // Plotly listens to mousedown / touchstart; swallow the ones that follow our pointerdown.
  function onMouseDown(e) {
    if (!swallowMouse) return
    swallowMouse = false
    e.stopPropagation()
    e.preventDefault()
  }

  function onDragMove(e) {
    if (!drag) return
    lastMove = rel(e)
    // Curve (denorm) drags apply at once: the preview design call already
    // coalesces to the latest step. Handle drags batch per frame.
    if (drag.kind === 'curve') { applyMove(); return }
    if (moveFrame != null) return
    moveFrame = requestAnimationFrame(applyMove)
  }

  function applyMove() {
    moveFrame = null
    if (!drag || !lastMove) return
    const ax = axesOf(gd)
    if (!ax) return
    const [px, py] = lastMove
    if (drag.kind === 'curve') {
      // Pointer travel across the transition band maps to 0–100 % denorm.
      const { passHz, stopHz } = drag.gap
      const span = Math.log10(stopHz) - Math.log10(passHz)
      const raw = drag.startDenorm + (100 * (Math.log10(pointerHz(px)) - drag.grabLog)) / span
      const d = Math.round(Math.min(100, Math.max(0, raw)))
      if (d !== drag.d) { drag.d = d; drag.moved = true; liveDenorm.update(d) }
      curveGuide = { ...drag.gap, levelDb: drag.levelDb, d }
      label = { x: px + 14, y: py - 30, text: `Denorm = ${d}%` }
      return
    }
    const tx = px - drag.gx, ty = py - drag.gy
    const xPlot = ax.xa.l2d(ax.xa.p2l(tx - ax.xa._offset))
    const yDb   = ax.ya.l2d(ax.ya.p2l(ty - ax.ya._offset))
    const next = dragTo(drag.startForm, drag.h, xPlot / axis.scale, yDb, uf)
    drag.moved = true
    designForm.set(next)
    label = { x: px + 14, y: py - 30, text: labelText(drag.h, next) }
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragCancel)
    window.removeEventListener('keydown', onKey)
    if (moveFrame != null) { cancelAnimationFrame(moveFrame); moveFrame = null }
    const d = drag
    drag = null
    dragging = false
    templateDragging.set(false)
    label = null
    lastMove = null
    curveGuide = null
    if (d?.kind === 'curve') liveDenorm.end()
    return d
  }

  function onDragEnd() {
    if (moveFrame != null) applyMove()
    const d = endDrag()
    // Q3: releasing a template drag re-designs (a curve drag already did, live).
    if (d?.kind === 'handle' && d.moved) runDesign()
  }

  function onDragCancel() {
    if (drag?.kind === 'curve' && drag.moved) liveDenorm.update(drag.startDenorm)
    const d = endDrag()
    if (d?.kind === 'handle') designForm.set(d.startForm)
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onDragCancel() }
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
    endDrag()
    if (ownHover) hoveredFields.set([])
    gd?.removeEventListener('pointerdown', onDown, true)
    gd?.removeEventListener('mousedown', onMouseDown, true)
    gd?.removeEventListener('touchstart', onMouseDown, true)
    gd?.removeEventListener('pointermove', onHoverMove)
    gd?.removeEventListener('pointerleave', onLeave)
  })

  // ── Compliance chips ─────────────────────────────────────────────────────
  function fmtMargin(c) {
    const m = c.margin
    const s = `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(2)} dB`
    return c.ok ? s : `${s} @ ${formatSI(c.at * uf)} ${$dataUnit === 'rad' ? 'rad/s' : 'Hz'}`
  }

  $: yLabel = $plotUnit === 'rad' ? '$|H(\\omega)|\\ [\\mathrm{dB}]$' : '$|H(f)|\\ [\\mathrm{dB}]$'
  $: uirevision = showTemplate ? `tpl-${$designForm.filterType}-${$plotUnit}` : undefined
</script>

<BodePlot
  bind:this={plot}
  {traces}
  {shapes}
  {yRange}
  {xRange}
  {uirevision}
  {yLabel}
  xLabel={axis.xLabel}
  logX={true}
  filename={showTemplate ? 'filtool_template' : 'filtool_magnitude'}
  active={$activeTab === tabId}
  on:rendered={onRendered}
>
  <canvas class="denorm-overlay" bind:this={overlay} aria-hidden="true"></canvas>
  {#if showTemplate && geom}
    <div class="tpl-overlay">
      {#if $bodeData && comp?.pass}
        <span class="chip" class:bad={!comp.pass.ok} title="Worst-case margin above the passband limit">
          Pass {comp.pass.ok ? '✓' : '✗'} <b>{fmtMargin(comp.pass)}</b>
        </span>
      {/if}
      {#if $bodeData && comp?.stop}
        <span class="chip" class:bad={!comp.stop.ok} title="Worst-case margin below the stopband limit">
          Stop {comp.stop.ok ? '✓' : '✗'} <b>{fmtMargin(comp.stop)}</b>
        </span>
      {/if}
      {#if symGeom}
        <span class="chip muted" title="With band edges the engine keeps the {geom.ft === 2 ? 'passband' : 'stopband'} centre and tightens the looser {geom.ft === 2 ? 'stop' : 'pass'} edge so the band is geometrically symmetric; the design is made for that template">
          Dotted grey: symmetric template used by the design
        </span>
      {/if}
      {#if !$filterParams}
        <span class="chip muted">Template preview · press Design</span>
      {:else if stale && !dragging && !$liveAdjusting}
        <button class="chip action" disabled={$designBusy} on:click={runDesign}>
          {$designBusy ? 'Designing…' : 'Out of date · Redesign'}
        </button>
      {/if}
    </div>
    {#if label}
      <div class="drag-label" style="left: {label.x}px; top: {label.y}px">{label.text}</div>
    {/if}
  {/if}
</BodePlot>

<style>
  .tpl-overlay {
    position: absolute;
    top: 42px;
    left: 72px;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    pointer-events: none;
    z-index: 5;
    max-width: calc(100% - 240px);
  }
  .chip {
    font-size: 0.74rem;
    line-height: 1.2;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--success) 45%, var(--border));
    background: color-mix(in srgb, var(--success) 12%, var(--surface));
    color: var(--text);
    white-space: nowrap;
  }
  .chip b { font-weight: 600; font-family: ui-monospace, 'SF Mono', Consolas, monospace; }
  .chip.bad {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    background: color-mix(in srgb, var(--danger) 14%, var(--surface));
  }
  .chip.muted {
    border-color: var(--border);
    background: var(--surface);
    color: var(--text-dim);
  }
  .chip.action {
    pointer-events: auto;
    cursor: pointer;
    font: inherit;
    font-size: 0.74rem;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
  }
  .chip.action:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 26%, var(--surface)); }
  .chip.action:disabled { opacity: 0.6; cursor: default; }

  .denorm-overlay { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 4; }
  .drag-label {
    position: absolute;
    pointer-events: none;
    z-index: 6;
    font-size: 0.76rem;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
  }

  /* Handle cursors override Plotly's drag-layer cursor */
  :global(.js-plotly-plot[data-tpl-cursor='ew'] .nsewdrag),
  :global(.js-plotly-plot[data-tpl-cursor='ew'] .drag) { cursor: ew-resize !important; }
  :global(.js-plotly-plot[data-tpl-cursor='ns'] .nsewdrag),
  :global(.js-plotly-plot[data-tpl-cursor='ns'] .drag) { cursor: ns-resize !important; }
  :global(.js-plotly-plot[data-tpl-cursor='move'] .nsewdrag),
  :global(.js-plotly-plot[data-tpl-cursor='move'] .drag) { cursor: move !important; }
  :global(.js-plotly-plot[data-tpl-cursor='col'] .nsewdrag),
  :global(.js-plotly-plot[data-tpl-cursor='col'] .drag) { cursor: col-resize !important; }
</style>
