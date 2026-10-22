<script>
  // X (Lin / Log / sinh) and Y (dB / Lin / sinh) axis-scale selectors for the
  // frequency-response plots. One persisted choice per axis, shared by every
  // plot that shows it (stores/app.js).
  import { xScaleKind, yScaleKind, lang } from '../stores/app.js'
  import { table } from '../lib/i18n.js'
  import Segmented from './form/Segmented.svelte'

  /** Show the X (frequency) selector. */
  export let x = true
  /** Show the Y (magnitude) selector. */
  export let y = false

  const TX = {
    en: {
      xAxis: 'X axis scale', yAxis: 'Y axis scale',
      lin: 'Lin', log: 'Log', db: 'dB',
      sinhX: 'asinh scale: linear below the lowest designed frequency, logarithmic above (reaches 0)',
      sinhY: 'asinh scale: linear below the stopband level, logarithmic above (zeros reach 0)',
      linY: 'Linear magnitude |H| (V/V)',
    },
    es: {
      xAxis: 'Escala del eje X', yAxis: 'Escala del eje Y',
      lin: 'Lin', log: 'Log', db: 'dB',
      sinhX: 'Escala asinh: lineal bajo la frecuencia más baja diseñada, logarítmica por encima (llega a 0)',
      sinhY: 'Escala asinh: lineal bajo el nivel de la banda de atenuación, logarítmica por encima (los ceros llegan a 0)',
      linY: 'Magnitud lineal |H| (V/V)',
    },
  }
  $: tx = table(TX, $lang)

  $: xOptions = [
    { value: 'lin', label: tx.lin }, { value: 'log', label: tx.log }, { value: 'sinh', label: 'sinh', title: tx.sinhX },
  ]
  $: yOptions = [
    { value: 'db', label: tx.db }, { value: 'lin', label: tx.lin, title: tx.linY }, { value: 'sinh', label: 'sinh', title: tx.sinhY },
  ]
</script>

<div class="scales">
  {#if x}
    <span class="sc-lbl">X</span>
    <Segmented size="sm" options={xOptions} bind:value={$xScaleKind} ariaLabel={tx.xAxis} />
  {/if}
  {#if y}
    <span class="sc-lbl">Y</span>
    <Segmented size="sm" options={yOptions} bind:value={$yScaleKind} ariaLabel={tx.yAxis} />
  {/if}
</div>

<style>
  .scales { display: flex; align-items: center; gap: 0.35rem; }
  .sc-lbl {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }
  .sc-lbl:not(:first-child) { margin-left: 0.5rem; }
</style>
