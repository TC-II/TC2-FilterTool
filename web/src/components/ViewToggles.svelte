<script>
  // Plot display toggles as one compact icon group: hover cursor, comparison
  // line style (solid / dashed) and legend. Icons instead of words, so the
  // header doesn't move when the language changes; the meaning is in the
  // tooltips / aria labels.
  import { plotCursor, compareDash, showLegend, lang } from '../stores/app.js'
  import { table } from '../lib/i18n.js'

  const TX = {
    en: {
      group: 'Plot display',
      cursorOn: 'Plot cursor: on (hover readout). Click to hide',
      cursorOff: 'Plot cursor: off. Click to show the hover readout',
      dashed: 'Comparison traces: dashed. Click for solid',
      solid: 'Comparison traces: solid. Click for dashed',
      legendOn: 'Legend: shown. Click to hide',
      legendOff: 'Legend: hidden. Click to show',
      cursor: 'Plot cursor', lineStyle: 'Dashed comparison traces', legend: 'Plot legend',
    },
    es: {
      group: 'Visualización de los gráficos',
      cursorOn: 'Cursor de los gráficos: activado (lectura al pasar el mouse). Clic para ocultarlo',
      cursorOff: 'Cursor de los gráficos: desactivado. Clic para mostrar la lectura al pasar el mouse',
      dashed: 'Curvas de comparación: punteadas. Clic para continuas',
      solid: 'Curvas de comparación: continuas. Clic para punteadas',
      legendOn: 'Leyenda: visible. Clic para ocultarla',
      legendOff: 'Leyenda: oculta. Clic para mostrarla',
      cursor: 'Cursor de los gráficos', lineStyle: 'Curvas de comparación punteadas', legend: 'Leyenda de los gráficos',
    },
  }
  $: tx = table(TX, $lang)
</script>

<div class="vt" role="group" aria-label={tx.group}>
  <button
    type="button"
    class:on={$plotCursor}
    aria-pressed={$plotCursor}
    aria-label={tx.cursor}
    title={$plotCursor ? tx.cursorOn : tx.cursorOff}
    on:click={() => plotCursor.update(v => !v)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.2v3.2M8 11.6v3.2M1.2 8h3.2M11.6 8h3.2" />
      <circle class="dot" cx="8" cy="8" r="0.9" />
    </svg>
  </button>

  <button
    type="button"
    class:on={$compareDash}
    aria-pressed={$compareDash}
    aria-label={tx.lineStyle}
    title={$compareDash ? tx.dashed : tx.solid}
    on:click={() => compareDash.update(v => !v)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path class="main" d="M1.5 5h13" />
      <path class="cmp" class:dash={$compareDash} d="M1.5 11h13" />
    </svg>
  </button>

  <button
    type="button"
    class:on={$showLegend}
    aria-pressed={$showLegend}
    aria-label={tx.legend}
    title={$showLegend ? tx.legendOn : tx.legendOff}
    on:click={() => showLegend.update(v => !v)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path class="key a" d="M4 6.2h2.6" />
      <path class="txt" d="M8.4 6.2h3.6" />
      <path class="key b" d="M4 9.8h2.6" />
      <path class="txt" d="M8.4 9.8h3.6" />
      {#if !$showLegend}<path class="slash" d="M2 14 14 2" />{/if}
    </svg>
  </button>
</div>

<style>
  .vt {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.95rem;
    height: 1.5rem;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  button:hover:not(.on) { background: var(--surface-2); color: var(--text-muted); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button.on {
    background: var(--selected);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .dot { fill: currentColor; stroke: none; }
  .main { stroke-width: 2; }
  .cmp { stroke-width: 2; }
  .cmp.dash { stroke-dasharray: 2.6 2; stroke-linecap: butt; }
  .key { stroke-width: 2; }
  .key.a { stroke: #58a6ff; }
  .key.b { stroke: #ffa657; }
  :global(:root[data-theme='light']) .key.a { stroke: #1f77b4; }
  :global(:root[data-theme='light']) .key.b { stroke: #ff7f0e; }
  button:not(.on) .key { stroke: currentColor; }
  .txt { stroke-width: 1.2; opacity: 0.7; }
  .slash { stroke-width: 1.5; }
</style>
