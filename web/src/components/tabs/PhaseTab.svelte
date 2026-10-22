<script>
  import { bodeData, filterParams, comparisons, theme, compareDash, colorMode, colorShuffle, activeTab, plotUnit, lang, xScaleKind } from '../../stores/app.js'
  import { approxName } from '../../lib/i18n.js'
  import { plotColor, compareLine, freqAxis } from '../../lib/approx.js'
  import { freqSetup } from '../../lib/axis-scale.js'
  import BodePlot from '../BodePlot.svelte'
  import ScaleToggles from '../ScaleToggles.svelte'

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

  $: axis = freqAxis($plotUnit)

  $: traces = [
    ...($bodeData ? [{
      x: $bodeData.freq.map(f => f * axis.scale),
      y: $bodeData.phase,
      mode: 'lines',
      name: approxName($filterParams?.approx_type ?? 0, $lang),
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq.map(f => f * axis.scale),
      y: c.bodeData.phase,
      mode: 'lines',
      name: approxName(c.approxType, $lang),
      line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
    })),
  ]

  // Log keeps Plotly's own x fit; linear / sinh run down to DC
  $: fr = $bodeData?.freq?.length ? { min: $bodeData.freq[0], max: $bodeData.freq[$bodeData.freq.length - 1] } : null
  $: xSetup = freqSetup($xScaleKind, fr ? fr.min * axis.scale : 1, fr ? fr.max * axis.scale : 1)
  $: xRange = fr && $xScaleKind !== 'log' ? xSetup.range : null

  $: yDtick = phaseDtick(traces)
  $: yLabel = $plotUnit === 'rad' ? '$\\angle H(\\omega)\\ [^\\circ]$' : '$\\angle H(f)\\ [^\\circ]$'
</script>

<div class="phase-tab">
  <div class="plot-bar"><ScaleToggles /></div>
  <div class="plot-host">
    <BodePlot
      {traces}
      {yLabel}
      {xRange}
      xLabel={axis.xLabel}
      xScale={xSetup.scale}
      {yDtick}
      uirevision={`phase-${$filterParams?.filter_type ?? '-'}-${$plotUnit}-${$xScaleKind}`}
      filename="filtool_phase"
      active={$activeTab === 'phase'}
    />
  </div>
</div>

<style>
  .phase-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
  .plot-host { flex: 1; min-height: 0; min-width: 0; }
  .plot-bar {
    flex: 0 0 auto; display: flex; align-items: center;
    min-height: 2rem; padding: 0.2rem 0.75rem; border-bottom: 1px solid var(--surface-2);
  }
</style>
