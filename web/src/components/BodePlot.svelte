<script module>
  import Plotly from 'plotly.js-dist'

  // Mode-bar tooltips for Plotly, with the mouse shortcuts spelled out (Shift
  // swaps zoom box / pan while dragging; double-click resets the axes). Only
  // the dictionary: number formatting stays Plotly's default (decimal dot).
  const PLOTLY_EN = {
    moduleType: 'locale',
    name: 'en-ft',
    dictionary: {
      'Zoom': 'Zoom: drag a box (hold Shift to pan)',
      'Pan': 'Pan: drag (hold Shift to zoom a box)',
      'Reset axes': 'Reset axes (or double-click the plot)',
      'Reset view': 'Reset view (or double-click the plot)',
    },
  }
  const PLOTLY_ES = {
    moduleType: 'locale',
    name: 'es',
    dictionary: {
      'Autoscale': 'Autoescalar',
      'Box Select': 'Selección rectangular',
      'Lasso Select': 'Selección con lazo',
      'Compare data on hover': 'Comparar datos al pasar el mouse',
      'Show closest data on hover': 'Mostrar el dato más cercano al pasar el mouse',
      'Toggle Spike Lines': 'Mostrar/ocultar líneas guía',
      'Double-click to zoom back out': 'Doble clic para volver a alejar',
      'Download plot': 'Descargar gráfico',
      'Download plot as a png': 'Descargar gráfico como png',
      'Pan': 'Desplazar: arrastre (con Shift, zoom con un recuadro)',
      'Reset axes': 'Restablecer ejes (o doble clic en el gráfico)',
      'Reset view': 'Restablecer vista (o doble clic en el gráfico)',
      'Zoom': 'Zoom: arrastre un recuadro (con Shift, desplazar)',
      'Zoom in': 'Acercar',
      'Zoom out': 'Alejar',
    },
  }
  let registered = false
  /** Plotly `config.locale` for a UI language (registers the dictionaries once). */
  export function plotlyLocale(lang) {
    if (!registered) { Plotly.register(PLOTLY_EN); Plotly.register(PLOTLY_ES); registered = true }
    return lang === 'es' ? 'es' : 'en-ft'
  }

  /** Mode-bar buttons no FilterTool plot uses (selection tools, autoscale ≈ home). */
  export const MODEBAR_REMOVE = ['select2d', 'lasso2d', 'autoScale2d']
</script>

<script>
  import { onMount, onDestroy, afterUpdate, createEventDispatcher } from 'svelte'
  import { theme, showLegend, plotCursor, lang } from '../stores/app.js'
  import { beginPlotWork } from '../lib/plot-activity.js'
  import { setHome } from '../lib/plot-home.js'

  const EXPORT_TITLE = { en: 'Export as SVG', es: 'Exportar como SVG' }

  export let traces    = []
  export let xLabel    = '$f\\ [\\mathrm{Hz}]$'
  export let yLabel    = ''
  export let logX      = true
  export let filename  = 'filtool_plot'
  export let shapes    = []
  export let yRange    = null
  /** Explicit x range in data units (log axes convert internally); null = autorange. */
  export let xRange    = null
  /** Plotly uirevision: user zoom/pan survives re-renders while this stays the same. */
  export let uirevision = undefined
  /** Fixed y-axis tick step (e.g. 45 for phase in degrees). */
  export let yDtick    = null
  /** When false (inactive keep-alive tab), skip Plotly work; rising edge re-typesets MathJax. */
  export let active    = true
  /** Optional color overrides (keys of plotColors()), e.g. the game mode's retro palette. */
  export let palette   = null
  /** Thumbnail: tight margins, no axis titles, legend, mode bar or export button; not interactive. */
  export let compact   = false

  const dispatch = createEventDispatcher()
  let container
  let initialized = false
  let destroyed = false
  let resizeObserver
  let wasActive = active
  let refreshTimer = null
  let refreshDone = null   // plot-activity token of the scheduled refresh
  let refreshToken = 0
  let lastTheme = $theme

  $: _plotPrefs = `${$theme}|${$showLegend}|${$plotCursor}|${xLabel}|${yLabel}|${yDtick}|${active}|${$lang}`
  $: void _plotPrefs

  function plotColors() {
    const light = $theme === 'light'
    const base = {
      background: light ? '#f6f8fa' : '#0d1117',
      text:       light ? '#24292f' : '#e6edf3',
      grid:       light ? '#d8dee4' : '#30363d',
      line:       light ? '#afb8c1' : '#484f58',
      legend:     light ? '#ffffff' : '#161b22',
      border:     light ? '#d0d7de' : '#30363d',
      modebar:        light ? '#57606a' : '#8b949e',
      modebarActive:  light ? '#0969da' : '#58a6ff',
      modebarBg:      light ? 'rgba(255,255,255,0.85)' : 'rgba(22,27,34,0.85)',
      // Cursor crosshair: Plotly's default is a 1 px dotted #444, barely visible
      spike:          light ? '#57606a' : '#8b949e',
    }
    return palette ? { ...base, ...palette } : base
  }

  function makeLayout() {
    const colors = plotColors()
    return {
      paper_bgcolor: colors.background,
      plot_bgcolor:  colors.background,
      font:          { color: colors.text, size: 12, family: 'system-ui, sans-serif' },
      margin:        compact ? { l: 40, r: 8, t: 8, b: 24 } : { l: 64, r: 24, t: 36, b: 56 },
      ...(uirevision !== undefined ? { uirevision } : {}),
      xaxis: {
        type:          logX ? 'log' : 'linear',
        ...(xRange ? { range: logX ? xRange.map(Math.log10) : xRange, autorange: false } : { autorange: true }),
        title:         compact ? undefined : { text: xLabel, standoff: 8, font: { color: colors.text, size: 12 } },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
        tickfont:      { color: colors.text, size: compact ? 9 : 11 },
        showspikes: true, spikemode: 'across', spikesnap: 'cursor',
        spikecolor: colors.spike, spikethickness: 1.5, spikedash: 'dash',
      },
      yaxis: {
        title:         compact ? undefined : { text: yLabel, standoff: 8, font: { color: colors.text, size: 12 } },
        gridcolor:     colors.grid,
        linecolor:     colors.line,
        zerolinecolor: colors.line,
        tickcolor:     colors.line,
        tickfont:      { color: colors.text, size: compact ? 9 : 11 },
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
      showlegend: !compact && $showLegend,
      hovermode: !compact && $plotCursor ? 'x unified' : false,
      modebar: {
        color:       colors.modebar,
        activecolor: colors.modebarActive,
        bgcolor:     colors.modebarBg,
      },
      shapes,
    }
  }

  $: CONFIG = {
    locale:        plotlyLocale($lang),
    responsive:    true,
    displaylogo:   false,
    // Double-click always goes Home (Plotly's default alternates with "fit all")
    doubleClick:   'reset',
    displayModeBar: !compact,
    staticPlot:    compact,
    modeBarButtonsToRemove: MODEBAR_REMOVE,
    toImageButtonOptions: { format: 'svg', filename },
  }

  async function awaitMathJax() {
    try {
      const mj = globalThis.MathJax
      if (mj?.startup?.promise) await mj.startup.promise
    } catch { /* MathJax optional */ }
  }

  // Home / double-click go to the ranges this plot was last given (lib/plot-home.js)
  let homeKey = null
  function syncHome() {
    const key = `${xRange?.join(',')}|${yRange?.join(',')}|${logX}|${uirevision}`
    if (key === homeKey) return
    homeKey = key
    setHome(container, { xaxis: !!xRange, yaxis: !!yRange })
  }

  async function refreshPlot() {
    if (!initialized || destroyed || !container || !active) return
    const token = ++refreshToken
    await awaitMathJax()
    if (token !== refreshToken || destroyed || !container || !active) return
    await Plotly.react(container, traces, makeLayout(), CONFIG)
    if (token !== refreshToken || destroyed || !container || !active) return
    syncHome()
    Plotly.Plots.resize(container)
    dispatch('rendered')
  }

  /**
   * Colors-only layout patch. Inactive tabs skip refreshPlot, so without this
   * they keep the old theme's paper until their first activation — which reads
   * as a dark flash when the tab is finally shown. Deliberately omits titles so
   * hidden plots never re-typeset MathJax at 0 size.
   */
  function recolor() {
    if (!initialized || destroyed || !container) return
    const c = plotColors()
    Plotly.relayout(container, {
      paper_bgcolor: c.background,
      plot_bgcolor:  c.background,
      'font.color':  c.text,
      'xaxis.gridcolor':     c.grid,
      'xaxis.linecolor':     c.line,
      'xaxis.zerolinecolor': c.line,
      'xaxis.tickcolor':     c.line,
      'xaxis.tickfont.color': c.text,
      'yaxis.gridcolor':     c.grid,
      'yaxis.linecolor':     c.line,
      'yaxis.zerolinecolor': c.line,
      'yaxis.tickcolor':     c.line,
      'yaxis.tickfont.color': c.text,
      'legend.bgcolor':      c.legend,
      'legend.bordercolor':  c.border,
      'modebar.color':       c.modebar,
      'modebar.activecolor': c.modebarActive,
      'modebar.bgcolor':     c.modebarBg,
      'xaxis.spikecolor':    c.spike,
      shapes,   // template mask fill is theme-dependent too
    })
  }

  $: if (initialized && $theme !== lastTheme) {
    lastTheme = $theme
    recolor()
  }

  // Throttle, not debounce: continuous updates (denorm slider, live mode) must
  // redraw while they happen, not only once they stop. The pending refresh
  // reads the latest props when it fires.
  function scheduleRefresh(delayMs = 32) {
    if (refreshTimer != null) return
    const done = refreshDone = beginPlotWork()
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refreshDone = null
      refreshPlot().finally(done)
    }, delayMs)
  }

  // Props that changed while this keep-alive tab was hidden (its refresh is skipped).
  let staleWhileHidden = false

  $: if (initialized && active && !wasActive) {
    wasActive = true
    // Stale data: redraw now, in the same update that shows the tab, so the
    // first painted frame is current (a timer here showed the old curve for
    // ~90 ms, a visible flicker).
    if (staleWhileHidden) {
      staleWhileHidden = false
      lastInputs = [traces, _plotPrefs, yRange, xRange, uirevision, logX, yDtick]
      lastShapes = shapes
      refreshPlot()
    }
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

  // Shape-only updates (template drag / hover) skip the full react + MathJax +
  // resize path and patch the shapes directly, coalesced per animation frame.
  let lastInputs = null
  let lastShapes = null
  let shapesFrame = null

  function patchShapes() {
    if (shapesFrame != null) return
    shapesFrame = requestAnimationFrame(() => {
      shapesFrame = null
      if (!initialized || destroyed || !container || !active) return
      lastShapes = shapes
      Plotly.relayout(container, { shapes })
    })
  }

  afterUpdate(() => {
    // Skip inactive tabs — overlapping reacts while hidden leave MathJax titles blank.
    if (initialized && !destroyed && !active) { staleWhileHidden = true; return }
    if (!initialized || destroyed) return
    const inputs = [traces, _plotPrefs, yRange, xRange, uirevision, logX, yDtick]
    const same = lastInputs && inputs.every((v, i) => v === lastInputs[i])
    if (same && refreshTimer == null) {
      if (shapes !== lastShapes) patchShapes()
      return
    }
    lastInputs = inputs
    lastShapes = shapes
    scheduleRefresh()
  })

  onDestroy(() => {
    destroyed = true
    initialized = false
    if (refreshTimer != null) clearTimeout(refreshTimer)
    refreshDone?.()
    if (shapesFrame != null) cancelAnimationFrame(shapesFrame)
    refreshToken++
    resizeObserver?.disconnect()
    if (container) Plotly.purge(container)
  })

  /** The Plotly graph div (for overlays that hit-test in plot pixels). */
  export function plotElement() { return container }

  export function exportSVG() {
    Plotly.downloadImage(container, { format: 'svg', filename, width: 1100, height: 650 })
  }
</script>

<div class="plot-wrap">
  <div bind:this={container} class="plot-div"></div>
  <slot />
  {#if !compact}
    <button class="export-btn" on:click={exportSVG} title={EXPORT_TITLE[$lang] ?? EXPORT_TITLE.en}>
      SVG
    </button>
  {/if}
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
