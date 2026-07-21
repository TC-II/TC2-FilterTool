<script>
  import { onMount, onDestroy, afterUpdate } from 'svelte'
  import Plotly from 'plotly.js-dist'
  import { theme } from '../stores/app.js'

  export let traces    = []
  export let xLabel    = '$f$ [Hz]'
  export let yLabel    = ''
  export let logX      = true
  export let filename  = 'filtool_plot'
  export let shapes    = []
  export let yRange    = null

  let container
  let initialized = false
  let resizeObserver

  function plotColors() {
    const light = $theme === 'light'
    return {
      background: light ? '#f6f8fa' : '#0d1117',
      text:       light ? '#24292f' : '#c9d1d9',
      grid:       light ? '#d8dee4' : '#21262d',
      line:       light ? '#afb8c1' : '#30363d',
      legend:     light ? '#ffffff' : '#161b22',
      border:     light ? '#d0d7de' : '#30363d',
      modebar:        light ? '#57606a' : '#7d8590',
      modebarActive:  light ? '#0969da' : '#58a6ff',
      modebarBg:      light ? 'rgba(255,255,255,0.85)' : 'rgba(22,27,34,0.85)',
    }
  }

  function makeLayout() {
    const colors = plotColors()
    return {
      paper_bgcolor: colors.background,
      plot_bgcolor:  colors.background,
      font:          { color: colors.text, size: 12, family: 'system-ui, sans-serif' },
      // Tight margins → more pixels for the curve
      margin:        { l: 52, r: 12, t: 10, b: 44 },
      xaxis: {
        type:          logX ? 'log' : 'linear',
        title:         { text: xLabel, standoff: 4 },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
      },
      yaxis: {
        title:         { text: yLabel, standoff: 4 },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
        ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
      },
      legend: {
        bgcolor:     colors.legend,
        bordercolor: colors.border,
        borderwidth: 1,
        font:        { size: 11 },
        x: 1, xanchor: 'right',
        y: 1, yanchor: 'top',
      },
      hovermode: 'x unified',
      modebar: {
        color:       colors.modebar,
        activecolor: colors.modebarActive,
        bgcolor:     colors.modebarBg,
      },
      shapes,
    }
  }

  const CONFIG = {
    responsive:    true,
    displaylogo:   false,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
    toImageButtonOptions: { format: 'svg', filename },
  }

  onMount(() => {
    Plotly.newPlot(container, traces, makeLayout(), CONFIG)
    initialized = true
    // Plotly's responsive flag only watches window resize — sidebar toggle
    // changes the container without firing that, so observe the wrap.
    resizeObserver = new ResizeObserver(() => {
      if (initialized && container) Plotly.Plots.resize(container)
    })
    resizeObserver.observe(container)
  })

  afterUpdate(() => {
    if (initialized) Plotly.react(container, traces, makeLayout(), CONFIG)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    if (container) Plotly.purge(container)
  })

  export function exportSVG() {
    Plotly.downloadImage(container, { format: 'svg', filename, width: 1100, height: 650 })
  }
</script>

<div class="plot-wrap">
  <div bind:this={container} class="plot-div"></div>
  <button class="export-btn" on:click={exportSVG} title="Export as SVG">
    SVG
  </button>
</div>

<style>
  .plot-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .plot-div {
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    min-width: 0;
  }
  .export-btn {
    position: absolute;
    bottom: 0.4rem;
    left: 0.4rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.68rem;
    padding: 0.15rem 0.4rem;
    z-index: 10;
  }
  .export-btn:hover { color: var(--text-muted); background: var(--hover); }
</style>
