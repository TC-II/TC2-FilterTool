<script>
  import { onMount, onDestroy, afterUpdate } from 'svelte'
  import Plotly from 'plotly.js-dist'

  export let traces    = []
  export let xLabel    = '$f$ [Hz]'
  export let yLabel    = ''
  export let logX      = true
  export let filename  = 'filtool_plot'
  export let shapes    = []

  let container
  let initialized = false

  const DARK = {
    paper_bgcolor: '#0d1117',
    plot_bgcolor:  '#0d1117',
    font:          { color: '#c9d1d9', size: 11, family: 'system-ui, sans-serif' },
    gridcolor:     '#21262d',
    linecolor:     '#30363d',
  }

  function makeLayout() {
    return {
      paper_bgcolor: DARK.paper_bgcolor,
      plot_bgcolor:  DARK.plot_bgcolor,
      font:          DARK.font,
      margin:        { l: 64, r: 24, t: 16, b: 56 },
      xaxis: {
        type:          logX ? 'log' : 'linear',
        title:         { text: xLabel, standoff: 8 },
        gridcolor:     DARK.gridcolor,
        linecolor:     DARK.linecolor,
        zerolinecolor: DARK.linecolor,
        tickcolor:     DARK.linecolor,
      },
      yaxis: {
        title:         { text: yLabel, standoff: 8 },
        gridcolor:     DARK.gridcolor,
        linecolor:     DARK.linecolor,
        zerolinecolor: DARK.linecolor,
        tickcolor:     DARK.linecolor,
      },
      legend: {
        bgcolor:     '#161b22',
        bordercolor: '#30363d',
        borderwidth: 1,
        font:        { size: 10 },
      },
      hovermode: 'x unified',
      shapes,
    }
  }

  const CONFIG = {
    responsive:    true,
    displaylogo:   false,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d', 'resetScale2d'],
    toImageButtonOptions: { format: 'svg', filename },
  }

  onMount(() => {
    Plotly.newPlot(container, traces, makeLayout(), CONFIG)
    initialized = true
  })

  afterUpdate(() => {
    if (initialized) Plotly.react(container, traces, makeLayout(), CONFIG)
  })

  onDestroy(() => {
    if (container) Plotly.purge(container)
  })

  export function exportSVG() {
    Plotly.downloadImage(container, { format: 'svg', filename, width: 900, height: 500 })
  }
</script>

<div class="plot-wrap">
  <div bind:this={container} class="plot-div"></div>
  <button class="export-btn" on:click={exportSVG} title="Export as SVG (open in browser → Print → Save as PDF)">
    Export SVG
  </button>
</div>

<style>
  .plot-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .plot-div {
    flex: 1;
    min-height: 0;
  }
  .export-btn {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #7d8590;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    z-index: 10;
  }
  .export-btn:hover { color: #c9d1d9; background: #30363d; }
</style>
