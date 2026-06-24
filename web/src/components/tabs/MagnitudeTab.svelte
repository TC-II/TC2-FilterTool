<script>
  import { bodeData, filterParams, comparisons } from '../../stores/app.js'
  import { APPROX_NAMES, APPROX_COLORS } from '../../lib/approx.js'
  import BodePlot from '../BodePlot.svelte'

  function toDb(v) { return 20 * Math.log10(Math.max(v, 1e-12)) }

  const FILL       = 'rgba(239, 154, 154, 0.12)'
  const LINE_COLOR = 'rgba(239, 154, 154, 0.55)'
  const TWO_PI     = 2 * Math.PI

  function buildTemplateShapes(params, bode) {
    if (!params || !bode || params.filter_type === 4) return []

    const freq   = bode.freq
    const X0     = freq[0]
    const X1     = freq[freq.length - 1]
    const dbVals = bode.magnitude.map(toDb)
    const Y0     = Math.min(...dbVals) - 5
    const Y1     = Math.max(...dbVals) + 5

    const toHz   = w => w / TWO_PI
    const gainDb = 20 * Math.log10(Math.max(params.gain ?? 1, 1e-12))
    const pbBound = gainDb - params.ap_dB
    const sbBound = gainDb - params.aa_dB

    const rect = (x0, x1, y0, y1) => ({
      type: 'rect', xref: 'x', yref: 'y', layer: 'below',
      x0: Math.max(x0, X0), x1: Math.min(x1, X1),
      y0: Math.max(y0, Y0), y1: Math.min(y1, Y1),
      fillcolor: FILL,
      line: { color: LINE_COLOR, width: 1 },
    })

    const ft = params.filter_type
    if (ft === 0) {  // LP
      const fp = toHz(params.wp), fa = toHz(params.wa)
      return [rect(X0, fp, Y0, pbBound), rect(fa, X1, sbBound, Y1)]
    }
    if (ft === 1) {  // HP
      const fp = toHz(params.wp), fa = toHz(params.wa)
      return [rect(fp, X1, Y0, pbBound), rect(X0, fa, sbBound, Y1)]
    }
    if (ft === 2) {  // BP
      const [fp1, fp2] = params.wp.map(toHz)
      const [fa1, fa2] = params.wa.map(toHz)
      return [
        rect(fp1, fp2, Y0, pbBound),
        rect(X0, fa1, sbBound, Y1),
        rect(fa2, X1, sbBound, Y1),
      ]
    }
    if (ft === 3) {  // BR
      const [fp1, fp2] = params.wp.map(toHz)
      const [fa1, fa2] = params.wa.map(toHz)
      return [
        rect(X0, fp1, Y0, pbBound),
        rect(fp2, X1, Y0, pbBound),
        rect(fa1, fa2, sbBound, Y1),
      ]
    }
    return []
  }

  $: traces = [
    ...($bodeData ? [{
      x: $bodeData.freq,
      y: $bodeData.magnitude.map(toDb),
      mode: 'lines',
      name: APPROX_NAMES[$filterParams?.approx_type ?? 0],
      line: { color: APPROX_COLORS[$filterParams?.approx_type ?? 0], width: 2 },
    }] : []),
    ...$comparisons.map(c => ({
      x: c.bodeData.freq,
      y: c.bodeData.magnitude.map(toDb),
      mode: 'lines',
      name: APPROX_NAMES[c.approxType],
      line: { color: APPROX_COLORS[c.approxType], width: 1.5, dash: 'dash' },
    })),
  ]

  $: shapes = buildTemplateShapes($filterParams, $bodeData)
</script>

<BodePlot {traces} {shapes} xLabel="$f$ [Hz]" yLabel="$|H(f)|$ [dB]" logX={true} filename="filtool_magnitude" />
