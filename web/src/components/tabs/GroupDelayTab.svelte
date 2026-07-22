<script>
  import { bodeData, filterParams, comparisons, theme, compareDash, colorMode, colorShuffle, activeTab } from '../../stores/app.js'
  import { APPROX_NAMES, plotColor, compareLine } from '../../lib/approx.js'
  import BodePlot from '../BodePlot.svelte'

  const Y_LABEL = '$\\tau(f)$ [ms]'

  $: traces = [
    ...($bodeData ? [{
      x: $bodeData.freq,
      y: $bodeData.groupDelay.map(v => v * 1000),
      mode: 'lines',
      name: APPROX_NAMES[$filterParams?.approx_type ?? 0],
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq,
      y: c.bodeData.groupDelay.map(v => v * 1000),
      mode: 'lines',
      name: APPROX_NAMES[c.approxType],
      line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
    })),
  ]
</script>

<BodePlot
  {traces}
  xLabel={'$f$ [Hz]'}
  yLabel={Y_LABEL}
  logX={true}
  filename="filtool_groupdelay"
  active={$activeTab === 'groupDelay'}
/>
