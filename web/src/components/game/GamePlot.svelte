<script>
  // The one plot a game round is "given": magnitude, phase, group delay, step,
  // or pole-zero map. Traces are unnamed and single-coloured so the
  // legend, hover label or colour never gives the approximation away.
  // Line-up rounds overlay several filters, one slot colour (A–D) each.
  import BodePlot from '../BodePlot.svelte'
  import PzMap from '../PzMap.svelte'
  import { PLOT_LABELS } from '../../lib/game/quiz.js'

  /** @type {{ id: number, spec: any, view: { id: string }, design: any }} */
  export let round
  /** Thumbnail for a match-round option (no titles, not interactive). */
  export let compact = false

  const TRACE = '#00bcd4'
  const POLE = '#ff9800'
  const ZERO = '#00e5ff'
  const W = 2 * Math.PI

  /** Retro palette (neandertool colours) for BodePlot / PzMap. */
  const BODE_PALETTE = {
    background: '#0d2035', text: '#d4f1f9', grid: '#1b3a58', line: '#5d7fa0',
    legend: '#0a1628', border: '#5d4037',
    modebar: '#a0d8ef', modebarActive: '#00bcd4', modebarBg: 'rgba(10,22,40,0.85)', spike: '#a0d8ef',
  }
  const PZ_PALETTE = {
    unit: '#3c6184', grid: '#1b3a58', bg: '#0d2035', axis: '#5d7fa0', zero: '#5d7fa0', text: '#d4f1f9',
    legend: '#0a1628', legendBorder: '#5d4037',
  }

  const line = (x, y, color = TRACE, name = 'H') => ({
    x, y, mode: 'lines', name, showlegend: false,
    line: { color, width: 2.5 },
    hovertemplate: '%{x:.4g}, %{y:.4g}<extra></extra>',
  })

  /** Prefer 45° ticks, growing when the span would overcrowd the axis (as PhaseTab). */
  function phaseDtick(ys) {
    let lo = Infinity, hi = -Infinity
    for (const y of ys) if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y }
    let step = 45
    if (hi > lo) while ((hi - lo) / step > 10) step *= 2
    return step
  }

  /** Robust y range: ignore the numeric spikes jω-axis zeros put in τ(ω). */
  function robustRange(ys) {
    const v = ys.filter(Number.isFinite).sort((a, b) => a - b)
    if (!v.length) return null
    const hi = v[Math.floor(0.99 * (v.length - 1))]
    const lo = Math.min(0, v[Math.floor(0.01 * (v.length - 1))])
    return [lo - 0.05 * (hi - lo), hi * 1.15 || 1]
  }

  $: view = round.view.id
  $: d = round.design
  $: floorDb = -(round.spec.aaDb + 30)
  /** What gets drawn: the one design, or every line-up member in its slot colour. */
  $: members = round.lineup ?? [{ slot: 'H', color: TRACE, design: d }]
  const toDb = floor => m => Math.max(floor - 10, m > 0 ? 20 * Math.log10(m) : -Infinity)

  $: plot = (() => {
    const b = d.bode
    const w = b?.freq.map(f => f * W)
    switch (view) {
      case 'magnitude': return {
        traces: members.map(m => line(m.design.bode.freq.map(f => f * W), m.design.bode.magnitude.map(toDb(floorDb)), m.color, m.slot)),
        xLabel: PLOT_LABELS.freq, yLabel: PLOT_LABELS.magnitude, logX: true, yRange: [floorDb, 5],
      }
      case 'phase': return {
        traces: members.map(m => line(m.design.bode.freq.map(f => f * W), m.design.bode.phase, m.color, m.slot)),
        xLabel: PLOT_LABELS.freq, yLabel: PLOT_LABELS.phase, logX: true,
        yDtick: phaseDtick(members.flatMap(m => m.design.bode.phase)),
      }
      case 'groupDelay': return {
        traces: [line(w, b.groupDelay)],
        xLabel: PLOT_LABELS.freq, yLabel: PLOT_LABELS.groupDelay, logX: true, yRange: robustRange(b.groupDelay),
      }
      case 'step': return {
        traces: [line(d.step.time, d.step.value)],
        xLabel: PLOT_LABELS.time, yLabel: PLOT_LABELS.step, logX: false,
      }
      default: return null
    }
  })()

  const rootLabel = (p, re, im) => `${p} = ${re.toFixed(3)} ${im < 0 ? '−' : '+'} j${Math.abs(im).toFixed(3)}`
  $: groups = view !== 'poleZero' ? [] : round.lineup
    // Line-up: poles and zeros share the slot colour (as in the guide's figures)
    ? round.lineup.flatMap(m => [
      { roots: m.design.poles.map(([re, im]) => ({ re, im, label: rootLabel('p', re, im) })), symbol: 'x', color: m.color, size: 11, name: `${m.slot} poles`, showlegend: false },
      { roots: m.design.zeros.map(([re, im]) => ({ re, im, label: rootLabel('z', re, im) })), symbol: 'circle-open', color: m.color, size: 11, name: `${m.slot} zeros`, showlegend: false },
    ])
    : [
      { roots: d.poles.map(([re, im]) => ({ re, im, label: rootLabel('p', re, im) })), symbol: 'x', color: POLE, size: 12, name: 'Poles' },
      { roots: d.zeros.map(([re, im]) => ({ re, im, label: rootLabel('z', re, im) })), symbol: 'circle-open', color: ZERO, size: 12, name: 'Zeros' },
    ]

  /**
   * Roots stacked on one spot (n zeros at the origin, BR zeros at ±jω0…) can't
   * be counted by eye: pin their multiplicity next to the marker.
   */
  $: stacked = view !== 'poleZero' ? [] : round.lineup
    // Several filters stack on the same spots (HP zeros at the origin…): one row per slot
    ? round.lineup.flatMap((m, i) => [...multiplicities(m.design.zeros, m.color), ...multiplicities(m.design.poles, m.color)]
      .map(a => ({ ...a, text: `${m.slot}:${a.text}`, yshift: 12 + 16 * i })))
    : [...multiplicities(d.zeros, ZERO), ...multiplicities(d.poles, POLE)]
  function multiplicities(roots, color) {
    const out = []
    for (const [re, im] of roots) {
      const tol = 1e-6 * Math.max(1, Math.hypot(re, im))
      const hit = out.find(o => Math.hypot(o.re - re, o.im - im) < tol)
      if (hit) hit.n++
      else out.push({ re, im, n: 1 })
    }
    return out.filter(o => o.n > 1).map(o => ({
      re: o.re, im: o.im, text: String(o.n), color,
      font: { family: "'Press Start 2P', 'Courier New', monospace", size: 12 },
    }))
  }
</script>

<div class="game-plot">
  {#if round.lineup && !compact}
    <div class="slots" aria-label="Curves">
      {#each round.lineup as m}
        <span class="slot"><span class="dot" style:background={m.color}></span>{m.slot}</span>
      {/each}
    </div>
  {/if}
  {#key round.id}
    {#if view === 'poleZero'}
      <PzMap
        {groups}
        scale={1}
        xLabel={PLOT_LABELS.re}
        yLabel={PLOT_LABELS.im}
        resetKey={round.id}
        {compact}
        palette={PZ_PALETTE}
        annotations={stacked}
        filename="filtool_quiz_pz"
      />
    {:else if plot}
      <BodePlot
        traces={plot.traces}
        xLabel={plot.xLabel}
        yLabel={plot.yLabel}
        logX={plot.logX}
        yRange={plot.yRange ?? null}
        yDtick={plot.yDtick ?? null}
        uirevision={round.id}
        {compact}
        palette={BODE_PALETTE}
        filename={`filtool_quiz_${view}`}
      />
    {/if}
  {/key}
</div>

<style>
  .game-plot {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .slots {
    position: absolute;
    top: 8px;
    left: 72px;
    z-index: 5;
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  .slot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'Press Start 2P', 'Courier New', monospace;
    font-size: 10px;
    color: #fff;
    background: rgba(10, 22, 40, 0.85);
    border: 2px solid #5d4037;
    padding: 4px 6px;
  }
  .dot { width: 10px; height: 10px; border: 1px solid #fff; }
  .game-plot :global(.plot-wrap),
  .game-plot :global(.pz-wrap) { flex: 1; min-height: 0; }
</style>
