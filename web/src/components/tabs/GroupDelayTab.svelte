<script>
  import { bodeData, filterParams, comparisons } from '../../stores/app.js'
  import { APPROX_NAMES, APPROX_COLORS } from '../../lib/approx.js'
  import BodePlot from '../BodePlot.svelte'

  $: traces = [
    ...($bodeData ? [{
      x: $bodeData.freq,
      y: $bodeData.groupDelay.map(v => v * 1000),
      mode: 'lines',
      name: APPROX_NAMES[$filterParams?.approx_type ?? 0],
      line: { color: APPROX_COLORS[$filterParams?.approx_type ?? 0], width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq,
      y: c.bodeData.groupDelay.map(v => v * 1000),
      mode: 'lines',
      name: APPROX_NAMES[c.approxType],
      line: { color: APPROX_COLORS[c.approxType], width: 1.5, dash: 'dash' },
    })),
  ]
</script>

<BodePlot {traces} xLabel="$f$ [Hz]" yLabel="$\tau(f)$ [ms]" logX={true} filename="filtool_groupdelay" />
