<script>
  import { filterResult, filterParams, comparisons, bodePoints, theme, compareDash, colorMode, colorShuffle, activeTab, lang } from '../../stores/app.js'
  import { table, approxName } from '../../lib/i18n.js'
  import { plotColor, compareLine } from '../../lib/approx.js'
  import {
    computeImpulse, zpkGainFromBa, responseDuration, pickTimeUnit, scaleTimeResponse, IMPULSE_Y_LABEL,
  } from '../../lib/time-response.js'
  import BodePlot from '../BodePlot.svelte'

  const TX = {
    en: {
      empty: 'Enter a valid template to see its impulse response.',
      fail: 'Could not compute impulse response for this transfer function.',
    },
    es: {
      empty: 'Ingrese una plantilla válida para ver su respuesta al impulso.',
      fail: 'No se pudo calcular la respuesta al impulso para esta función transferencia.',
    },
  }
  $: tx = table(TX, $lang)

  function impulseOf(fr, pts, tEnd) {
    if (!fr) return null
    const k = zpkGainFromBa(fr.num, fr.den)
    if (k == null) return null
    return computeImpulse(fr.zeros, fr.poles, k, pts, tEnd)
  }

  $: tEnd = (() => {
    let maxT = 0
    if ($filterResult?.poles?.length) maxT = Math.max(maxT, responseDuration($filterResult.poles))
    for (const c of $comparisons) {
      if (c.filterResult?.poles?.length) maxT = Math.max(maxT, responseDuration(c.filterResult.poles))
    }
    return maxT > 0 ? maxT : undefined
  })()

  $: timeUnit = pickTimeUnit(tEnd ?? 1)

  $: main = scaleTimeResponse(impulseOf($filterResult, $bodePoints, tEnd), timeUnit.scale)

  $: traces = [
    ...(main ? [{
      x: main.time,
      y: main.value,
      mode: 'lines',
      name: approxName($filterParams?.approx_type ?? 0, $lang),
      line: { color: plotColor($filterParams?.approx_type ?? 0, $theme, $colorMode, $colorShuffle), width: 2 },
    }] : []),
    ...$comparisons.flatMap(c => {
      const tr = scaleTimeResponse(impulseOf(c.filterResult, $bodePoints, tEnd), timeUnit.scale)
      if (!tr) return []
      return [{
        x: tr.time,
        y: tr.value,
        mode: 'lines',
        name: approxName(c.approxType, $lang),
        line: compareLine(c.approxType, $theme, { dash: $compareDash, mode: $colorMode, shuffle: $colorShuffle }),
      }]
    }),
  ]
</script>

{#if !$filterResult}
  <div class="empty"><p>{tx.empty}</p></div>
{:else}
  <div class="time-tab">
    {#if !main}
      <p class="compute-warn">{tx.fail}</p>
    {/if}
    <BodePlot
      {traces}
      xLabel={timeUnit.xLabel}
      yLabel={IMPULSE_Y_LABEL}
      logX={false}
      filename="filtool_impulse"
      active={$activeTab === 'impulse'}
    />
  </div>
{/if}

<style>
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    padding: 1.25rem;
  }
  p {
    font-size: 0.85rem;
    color: var(--text-dim);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .time-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .compute-warn {
    flex: 0 0 auto;
    margin: 0;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    color: var(--text-dim);
    text-align: center;
  }
  .time-tab :global(.plot-wrap) {
    flex: 1;
    min-height: 0;
  }
</style>
