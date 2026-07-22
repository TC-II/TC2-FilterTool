<script>
  import { onMount } from 'svelte'
  import { proxy } from 'comlink'
  import { getWorkerApi } from './lib/worker-client.js'
  import { freqRangeFromParams } from './lib/approx.js'
  import {
    engineReady, engineError, engineStatus, engineProgress,
    activeTab, theme, bodePoints, filterResult, filterParams, bodeData,
    sidebarOpen, uiEnabled, compareDash, showLegend, colorMode, colorShuffle,
    stages, comparisons, compareApproxes, compareSameN, pendingFormHydration,
  } from './stores/app.js'
  import LoadingBadge  from './components/LoadingBadge.svelte'
  import TabBar        from './components/TabBar.svelte'
  import Sidebar       from './components/Sidebar.svelte'
  import MagnitudeTab  from './components/tabs/MagnitudeTab.svelte'
  import PhaseTab      from './components/tabs/PhaseTab.svelte'
  import GroupDelayTab from './components/tabs/GroupDelayTab.svelte'
  import StepTab       from './components/tabs/StepTab.svelte'
  import ImpulseTab    from './components/tabs/ImpulseTab.svelte'
  import PoleZeroTab   from './components/tabs/PoleZeroTab.svelte'
  import StagesTab     from './components/tabs/StagesTab.svelte'
  import { shufflePalette } from './lib/approx.js'
  import { serializeDesign, downloadDesign, pickDesignFile, materializeDesign } from './lib/design-io.js'

  const POINTS_OPTIONS = [2000, 5000, 10000, 20000, 50000, 100000]
  const COLOR_MODE_OPTIONS = [
    { id: 'default', label: 'Default' },
    { id: 'gray',    label: 'Gray' },
    { id: 'random',  label: 'Random' },
  ]

  let ioBusy = false
  let ioError = ''

  function onColorModeChange() {
    if ($colorMode === 'random') colorShuffle.set(shufflePalette())
  }
  // Chebyshev I / II / Cauer — dense ripples need more Bode samples at high order
  const DENSE_APPROX = new Set([1, 2, 3])

  $: pointsWarn = Boolean(
    $filterResult?.N > 6
    && DENSE_APPROX.has($filterParams?.approx_type)
    && Number($bodePoints) <= 5000
  )

  onMount(async () => {
    try {
      const api = getWorkerApi()
      await api.init(
        import.meta.env.BASE_URL,
        proxy((pct, status) => {
          engineProgress.set(pct)
          if (status) engineStatus.set(status)
        }),
      )
      engineProgress.set(100)
      engineReady.set(true)
      engineStatus.set('Ready')
    } catch (err) {
      engineError.set(err.message)
      console.error(err)
    }
  })

  async function onPointsChange() {
    // <select> values are strings; keep bodePoints numeric for the worker.
    const pts = Number($bodePoints)
    if (Number.isFinite(pts) && pts !== $bodePoints) bodePoints.set(pts)
    if (!$filterResult || !$filterParams) return
    try {
      const r = freqRangeFromParams($filterParams)
      const api = getWorkerApi()
      bodeData.set(await api.computeBode($filterResult.num, $filterResult.den, r.min, r.max, pts || $bodePoints))
    } catch (_) {}
  }

  function onSave() {
    ioError = ''
    try {
      const doc = serializeDesign({
        filterParams: $filterParams,
        stages: $stages,
        compareApproxes: $compareApproxes,
        compareSameN: $compareSameN,
        bodePoints: $bodePoints,
      })
      const ft = ['lp', 'hp', 'bp', 'br', 'gd'][$filterParams?.filter_type ?? 0] ?? 'filter'
      downloadDesign(doc, `filtertool-${ft}-n${$filterResult?.N ?? ''}`)
    } catch (e) {
      ioError = e.message ?? String(e)
    }
  }

  async function onLoad() {
    if (ioBusy || !$uiEnabled) return
    ioError = ''
    ioBusy = true
    try {
      const { doc } = await pickDesignFile()
      const api = getWorkerApi()
      const applied = await materializeDesign(doc, api, s => engineStatus.set(s))

      // Hydrate sidebar form first, then publish design state.
      pendingFormHydration.set(applied.filterParams)
      bodePoints.set(applied.bodePoints)
      stages.set(applied.stages)
      comparisons.set([])
      compareSameN.set(applied.compareSameN)
      compareApproxes.set(applied.compareApproxes)
      filterParams.set(applied.filterParams)
      filterResult.set(applied.filterResult)
      bodeData.set(applied.bodeData)
      engineStatus.set('Ready')
    } catch (e) {
      // User cancelled the file picker — not an error.
      if (e?.message === 'No file selected.') return
      ioError = e.message ?? String(e)
      engineStatus.set('Ready')
    } finally {
      ioBusy = false
    }
  }
</script>

<div class="app">
  <header>
    <button
      class="icon-btn"
      class:active={$sidebarOpen}
      on:click={() => sidebarOpen.update(v => !v)}
      aria-label={$sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      title={$sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      aria-pressed={$sidebarOpen}
    >
      Params
    </button>
    <img class="logo-icon" src="{import.meta.env.BASE_URL}favicon-48x48.png" width="28" height="28" alt="" />
    <span class="logo">FilterTool</span>
    <LoadingBadge />
    <div class="header-spacer"></div>

    <label
      class="nav-field"
      class:disabled={!$uiEnabled}
      class:warn={pointsWarn}
      title={pointsWarn
        ? 'High-order Chebyshev/Cauer: increase Points for accurate Bode plots'
        : 'Frequency points used for Bode plots'}
    >
      <span class="nav-lbl">Points</span>
      <select
        class="nav-sel"
        bind:value={$bodePoints}
        disabled={!$uiEnabled}
        on:change={onPointsChange}
      >
        {#each POINTS_OPTIONS as n}
          <option value={n}>{n.toLocaleString()}</option>
        {/each}
      </select>
    </label>

    <button
      class="header-btn"
      class:active={$compareDash}
      on:click={() => compareDash.update(v => !v)}
      aria-pressed={$compareDash}
      title={$compareDash ? 'Comparison traces: dashed' : 'Comparison traces: solid'}
    >
      {$compareDash ? 'Dashed' : 'Solid'}
    </button>
    <button
      class="header-btn"
      class:active={$showLegend}
      on:click={() => showLegend.update(v => !v)}
      aria-pressed={$showLegend}
      title={$showLegend ? 'Hide plot legend' : 'Show plot legend'}
    >
      Legend
    </button>
    <label class="nav-field" title="Trace colors for main + comparisons">
      <span class="nav-lbl">Colors</span>
      <select class="nav-sel" bind:value={$colorMode} on:change={onColorModeChange}>
        {#each COLOR_MODE_OPTIONS as opt}
          <option value={opt.id}>{opt.label}</option>
        {/each}
      </select>
    </label>

    <button
      class="header-btn"
      on:click={() => theme.set($theme === 'dark' ? 'light' : 'dark')}
      aria-label={`Switch to ${$theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${$theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {$theme === 'dark' ? 'Light' : 'Dark'}
    </button>
    <button
      class="header-btn"
      disabled={!$filterParams || ioBusy}
      on:click={onSave}
      title={$filterParams ? 'Save design to .ftjson' : 'Design a filter first'}
    >Save</button>
    <button
      class="header-btn"
      disabled={!$uiEnabled || ioBusy}
      on:click={onLoad}
      title="Load design from .ftjson"
    >{ioBusy ? 'Loading…' : 'Load'}</button>
  </header>
  {#if ioError}
    <div class="io-error" role="alert">{ioError}</div>
  {/if}

  <div class="body">
    <div class="sidebar-slot" class:closed={!$sidebarOpen} aria-hidden={!$sidebarOpen}>
      <Sidebar />
    </div>

    <div class="content">
      <TabBar />
      <div class="plot-area">
        <!-- Keep tabs mounted so Plotly isn't remounted at 0×0 / left as a ghost. -->
        <div class="tab-panel" class:active={$activeTab === 'magnitude'} aria-hidden={$activeTab !== 'magnitude'}>
          <MagnitudeTab showTemplate={false} />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'template'} aria-hidden={$activeTab !== 'template'}>
          <MagnitudeTab showTemplate={true} />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'phase'} aria-hidden={$activeTab !== 'phase'}>
          <PhaseTab />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'groupDelay'} aria-hidden={$activeTab !== 'groupDelay'}>
          <GroupDelayTab />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'step'} aria-hidden={$activeTab !== 'step'}>
          <StepTab />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'impulse'} aria-hidden={$activeTab !== 'impulse'}>
          <ImpulseTab />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'poleZero'} aria-hidden={$activeTab !== 'poleZero'}>
          <PoleZeroTab />
        </div>
        <div class="tab-panel" class:active={$activeTab === 'stages'} aria-hidden={$activeTab !== 'stages'}>
          <StagesTab />
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 15px;
  }
  :global(#app) {
    width: 100%;
    height: 100%;
    max-width: none;
    margin: 0;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-width: 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0 0.75rem;
    height: 44px;
    background: var(--surface);
    border-bottom: 1px solid var(--surface-2);
    flex-shrink: 0;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .logo-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
    display: block;
  }
  .logo {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .header-spacer { flex: 1; min-width: 0.5rem; }

  .icon-btn, .header-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0.28rem 0.65rem;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .icon-btn.active {
    color: var(--text);
    border-color: var(--accent);
    background: var(--selected);
  }
  .header-btn.active {
    color: var(--text);
    border-color: var(--accent);
    background: var(--selected);
  }
  .icon-btn:hover, .header-btn:hover:not(:disabled) { background: var(--hover); }
  .header-btn:disabled { opacity: 0.4; cursor: default; }

  .io-error {
    flex-shrink: 0;
    padding: 0.35rem 0.75rem;
    font-size: 0.82rem;
    color: var(--danger);
    background: var(--danger-bg);
    border-bottom: 1px solid var(--border);
  }

  .nav-field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  .nav-field.disabled { opacity: 0.45; pointer-events: none; }
  .nav-field.warn .nav-lbl { color: var(--warning); font-weight: 600; }
  .nav-field.warn .nav-sel {
    border-color: var(--warning);
    background: var(--warning-bg);
    color: var(--text);
  }
  .nav-lbl {
    font-size: 0.82rem;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .nav-sel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.82rem;
    padding: 0.25rem 0.4rem;
    outline: none;
    min-width: 5rem;
  }
  .nav-sel:focus { border-color: var(--accent); }

  .body {
    display: flex;
    flex: 1;
    width: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .sidebar-slot {
    display: flex;
    flex-shrink: 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .sidebar-slot.closed {
    display: none;
  }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .plot-area {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .tab-panel {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    /* Keep layout size for Plotly; only hide visually when inactive */
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
  }
  .tab-panel.active {
    visibility: visible;
    pointer-events: auto;
    z-index: 1;
  }

  @media (max-width: 720px) {
    header { gap: 0.35rem; padding: 0 0.4rem; }
    .logo { font-size: 0.8rem; }
    .body {
      flex-direction: column;
    }
  }
</style>
