<script>
  import { onMount, onDestroy, afterUpdate } from 'svelte'
  import Plotly from 'plotly.js-dist'
  import { theme, showLegend } from '../stores/app.js'

  export let traces    = []
  export let xLabel    = '$f$ [Hz]'
  export let yLabel    = ''
  export let logX      = true
  export let filename  = 'filtool_plot'
  export let shapes    = []
  export let yRange    = null
  /** Fixed y-axis tick step (e.g. 45 for phase in degrees). */
  export let yDtick    = null
  /** When false (inactive keep-alive tab), skip Plotly work; rising edge re-typesets MathJax. */
  export let active    = true

  let container
  let initialized = false
  let destroyed = false
  let resizeObserver
  let wasActive = active
  let refreshTimer = null
  let refreshToken = 0

  $: _plotPrefs = `${$theme}|${$showLegend}|${xLabel}|${yLabel}|${yDtick}|${active}`
  $: void _plotPrefs

  function plotColors() {
    const light = $theme === 'light'
    return {
      background: light ? '#f6f8fa' : '#0d1117',
      text:       light ? '#24292f' : '#e6edf3',
      grid:       light ? '#d8dee4' : '#30363d',
      line:       light ? '#afb8c1' : '#484f58',
      legend:     light ? '#ffffff' : '#161b22',
      border:     light ? '#d0d7de' : '#30363d',
      modebar:        light ? '#57606a' : '#8b949e',
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
      margin:        { l: 64, r: 24, t: 36, b: 56 },
      xaxis: {
        type:          logX ? 'log' : 'linear',
        title:         { text: xLabel, standoff: 8, font: { color: colors.text, size: 12 } },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
        tickfont:      { color: colors.text, size: 11 },
      },
      yaxis: {
        title:         { text: yLabel, standoff: 8, font: { color: colors.text, size: 12 } },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
        tickfont:      { color: colors.text, size: 11 },
        ...(yRange ? { range: yRange, autorange: false } : { autorange: true }),
        ...(yDtick != null ? { dtick: yDtick, tick0: 0 } : {}),
      },
      legend: {
        bgcolor:     colors.legend,
        bordercolor: colors.border,
        borderwidth: 1,
        font:        { size: 11 },
        x: 1, xanchor: 'right',
        y: 0.98, yanchor: 'top',
        tracegroupgap: 4,
      },
      showlegend: $showLegend,
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

  async function awaitMathJax() {
    try {
      const mj = globalThis.MathJax
      if (mj?.startup?.promise) await mj.startup.promise
    } catch { /* MathJax optional */ }
  }

  async function refreshPlot() {
    if (!initialized || destroyed || !container || !active) return
    const token = ++refreshToken
    await awaitMathJax()
    if (token !== refreshToken || destroyed || !container || !active) return
    await Plotly.react(container, traces, makeLayout(), CONFIG)
    if (token !== refreshToken || destroyed || !container || !active) return
    Plotly.Plots.resize(container)
  }

  function scheduleRefresh(delayMs = 32) {
    if (refreshTimer != null) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refreshPlot()
    }, delayMs)
  }

  $: if (initialized && active && !wasActive) {
    wasActive = true
    // Hidden keep-alive tabs typeset MathJax at 0 size; re-draw once visible.
    scheduleRefresh(50)
  } else if (!active) {
    wasActive = false
  }

  onMount(() => {
    Plotly.newPlot(container, traces, makeLayout(), CONFIG)
    initialized = true
    resizeObserver = new ResizeObserver(() => {
      if (initialized && !destroyed && active && container) Plotly.Plots.resize(container)
    })
    resizeObserver.observe(container)
    if (active) scheduleRefresh(0)
  })

  afterUpdate(() => {
    // Skip inactive tabs — overlapping reacts while hidden leave MathJax titles blank.
    if (!initialized || destroyed || !active) return
    scheduleRefresh()
  })

  onDestroy(() => {
    destroyed = true
    initialized = false
    if (refreshTimer != null) clearTimeout(refreshTimer)
    refreshToken++
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
