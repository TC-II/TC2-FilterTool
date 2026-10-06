<script>
  // Frequency units, as one compact group: form / readouts (sliders icon) and
  // plot axes (chart icon), each a Hz | rad/s pill with a sliding thumb. No
  // words that change with the language; the meaning is in the tooltips.
  import { dataUnit, plotUnit, lang } from '../stores/app.js'
  import { table } from '../lib/i18n.js'

  const TX = {
    en: {
      group: 'Frequency units',
      data: 'Data units', dataTitle: 'Units for the parameter form and pole/zero readouts',
      plots: 'Plot units', plotsTitle: 'Units for plot axes (Bode + pole/zero)',
    },
    es: {
      group: 'Unidades de frecuencia',
      data: 'Unidades de los datos', dataTitle: 'Unidades del formulario de parámetros y de los valores de polos/ceros',
      plots: 'Unidades de los gráficos', plotsTitle: 'Unidades de los ejes de los gráficos (Bode + polos/ceros)',
    },
  }
  $: tx = table(TX, $lang)

  const UNITS = [
    { id: 'hz', label: 'Hz' },
    { id: 'rad', label: 'rad/s' },
  ]
  $: rows = [
    { key: 'data', store: dataUnit, value: $dataUnit, label: tx.data, title: tx.dataTitle },
    { key: 'plots', store: plotUnit, value: $plotUnit, label: tx.plots, title: tx.plotsTitle },
  ]

  function onKey(e, store, value) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault()
      store.set(value === 'hz' ? 'rad' : 'hz')
    }
  }
</script>

<div class="ut" role="group" aria-label={tx.group}>
  {#each rows as r (r.key)}
    <div class="row" title={r.title}>
      <svg class="ico" viewBox="0 0 16 16" aria-hidden="true">
        {#if r.key === 'data'}
          <!-- Form: sliders -->
          <path d="M2 4h12M2 8h12M2 12h12" class="rail" />
          <circle cx="10.5" cy="4" r="1.6" />
          <circle cx="5" cy="8" r="1.6" />
          <circle cx="8.5" cy="12" r="1.6" />
        {:else}
          <!-- Plot: axes + a roll-off curve -->
          <path d="M1.8 1.5v12.7h12.7" class="rail" />
          <path class="curve" d="M3.6 4.2h4.6c2.4 0 3.4 2.6 5.2 7.8" />
        {/if}
      </svg>
      <div
        class="pill"
        class:rad={r.value === 'rad'}
        role="radiogroup"
        aria-label={r.label}
      >
        <span class="thumb" aria-hidden="true"></span>
        {#each UNITS as u}
          <button
            type="button"
            role="radio"
            aria-checked={r.value === u.id}
            tabindex={r.value === u.id ? 0 : -1}
            class:on={r.value === u.id}
            on:click={() => r.store.set(u.id)}
            on:keydown={e => onKey(e, r.store, r.value)}
          >{u.label}</button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .ut {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    gap: 0.5rem;
    height: 1.75rem;
    padding: 0 3px 0 0.4rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .row {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .row + .row {
    padding-left: 0.5rem;
    border-left: 1px solid var(--border);
  }
  .ico {
    width: 1.05rem;
    height: 1.05rem;
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ico circle { fill: var(--bg); }
  .ico .rail { opacity: 0.7; }
  .ico .curve { stroke-width: 1.7; }

  .pill {
    position: relative;
    display: inline-grid;
    grid-template-columns: 2.1rem 2.7rem;
    height: 1.35rem;
    padding: 1px;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .thumb {
    position: absolute;
    top: 1px;
    bottom: 1px;
    left: 1px;
    width: 2.1rem;
    border-radius: 3px;
    background: var(--selected);
    box-shadow: inset 0 0 0 1px var(--accent);
    transition: transform 0.18s ease-out, width 0.18s ease-out;
  }
  .pill.rad .thumb { transform: translateX(2.1rem); width: 2.7rem; }
  .pill button {
    position: relative;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.72rem;
    cursor: pointer;
    transition: color 0.15s;
  }
  .pill button:hover:not(.on) { color: var(--text-muted); }
  .pill button.on { color: var(--accent); font-weight: 600; }
  .pill button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 3px; }

  @media (prefers-reduced-motion: reduce) { .thumb { transition: none; } }
</style>
