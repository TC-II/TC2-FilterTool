<script>
  import { bodeData, filterParams, comparisons, theme, compareDash, colorMode, colorShuffle, activeTab } from '../../stores/app.js'
  import { APPROX_NAMES, plotColor, compareLine } from '../../lib/approx.js'
  import BodePlot from '../BodePlot.svelte'

  const Y_LABEL = '$\\angle H(f)$ [°]'
  const PHASE_BASE_TICK = 45
  const PHASE_MAX_TICKS = 10

  /** Prefer 45° ticks, but grow to 90/180/… when the span would overcrowd the axis. */
  function phaseDtick(trs) {
    let lo = Infinity
    let hi = -Infinity
    for (const tr of trs) {
      for (const y of tr.y ?? []) {
        if (!Number.isFinite(y)) continue
        if (y < lo) lo = y
        if (y > hi) hi = y
      }
    }
    if (!(hi > lo)) return PHASE_BASE_TICK
    const span = hi - lo
    let step = PHASE_BASE_TICK
    while (span / step > PHASE_MAX_TICKS) step *= 2
    return step
  }

  $: traces = [
    ...($bodeData ? [{
      x: $bodeData.freq,
      y: $bodeData.phase,
      mode: 'lines',
      name: APPROX_NAMES[$filterParams?.approx_type ?? 0],
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq,
      y: c.bodeData.phase,
      mode: 'lines',
      name: APPROX_NAMES[c.approxType],
      line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
    })),
  ]

  $: yDtick = phaseDtick(traces)
</script>

<BodePlot
  {traces}
  xLabel={'$f$ [Hz]'}
  yLabel={Y_LABEL}
  logX={true}
  {yDtick}
  filename="filtool_phase"
  active={$activeTab === 'phase'}
/>
