<script>
  import { onMount, onDestroy } from 'svelte'
  import { proxy } from 'comlink'
  import { getWorkerApi } from './lib/worker-client.js'
  import { designBode } from './lib/zpk-bode.js'
  import { freqRangeFromParams } from './lib/approx.js'
  import {
    engineReady, engineError, engineStatus, engineProgress,
    activeTab, theme, bodePoints, filterResult, filterParams, bodeData,
    sidebarOpen, uiEnabled, colorMode, colorShuffle,
    stages, comparisons, compareApproxes, compareSameN, pendingFormHydration,
    gameMode, lang,
  } from './stores/app.js'
  import { table, LANGS } from './lib/i18n.js'
  import LoadingBadge  from './components/LoadingBadge.svelte'
  import LangSwitch    from './components/LangSwitch.svelte'
  import StableText    from './components/StableText.svelte'
  import ViewToggles   from './components/ViewToggles.svelte'
  import PointsMeter   from './components/PointsMeter.svelte'
  import UnitToggles   from './components/UnitToggles.svelte'
  import TabBar        from './components/TabBar.svelte'
  import Sidebar       from './components/Sidebar.svelte'
  import MagnitudeTab  from './components/tabs/MagnitudeTab.svelte'
  import PhaseTab      from './components/tabs/PhaseTab.svelte'
  import GroupDelayTab from './components/tabs/GroupDelayTab.svelte'
  import StepTab       from './components/tabs/StepTab.svelte'
  import ImpulseTab    from './components/tabs/ImpulseTab.svelte'
  import PoleZeroTab   from './components/tabs/PoleZeroTab.svelte'
  import StagesTab     from './components/tabs/StagesTab.svelte'
  import Toast         from './components/Toast.svelte'
  import GameMode      from './components/game/GameMode.svelte'
  import { playEnter, playExit, initMascot } from './lib/game/transition.js'
  import { runDesign, startLiveMode } from './lib/design-action.js'
  import { removeStage } from './lib/stages.js'
  import { hoveredStageId } from './stores/app.js'
  import { shufflePalette } from './lib/approx.js'
  import { switchTheme } from './lib/theme-switch.js'
  import { serializeDesign, downloadDesign, pickDesignFile, materializeDesign, NO_FILE } from './lib/design-io.js'

  const TX = {
    en: {
      params: 'Params', hideSidebar: 'Hide sidebar', showSidebar: 'Show sidebar',
      game: 'GAME', gameTitle: 'Game mode: guess the approximation, type and order from a plot',
      colors: 'Colors', colorsTitle: 'Trace colors for main + comparisons',
      cDefault: 'Default', cGray: 'Gray', cRandom: 'Random',
      toLight: 'Switch to light mode', toDark: 'Switch to dark mode', light: 'Light', dark: 'Dark',
      save: 'Save', saveTitle: 'Save design to .ftjson', saveNeeds: 'Enter a valid template first',
      load: 'Load', loading: 'Loading…', loadTitle: 'Load design from .ftjson',
    },
    es: {
      params: 'Parámetros', hideSidebar: 'Ocultar el panel lateral', showSidebar: 'Mostrar el panel lateral',
      game: 'JUEGO', gameTitle: 'Modo juego: adivinar la aproximación, el tipo y el orden a partir de un gráfico',
      colors: 'Colores', colorsTitle: 'Colores de las curvas (principal + comparaciones)',
      cDefault: 'Por defecto', cGray: 'Gris', cRandom: 'Aleatorio',
      toLight: 'Cambiar a modo claro', toDark: 'Cambiar a modo oscuro', light: 'Claro', dark: 'Oscuro',
      save: 'Guardar', saveTitle: 'Guardar el diseño en .ftjson', saveNeeds: 'Primero ingrese una plantilla válida',
      load: 'Cargar', loading: 'Cargando…', loadTitle: 'Cargar un diseño desde .ftjson',
    },
  }
  $: tx = table(TX, $lang)
  /** Every language's text for these keys: header labels reserve the widest (StableText). */
  const all = (...keys) => keys.flatMap(k => LANGS.map(l => table(TX, l)[k]))

  $: COLOR_MODE_OPTIONS = [
    { id: 'default', label: tx.cDefault },
    { id: 'gray',    label: tx.cGray },
    { id: 'random',  label: tx.cRandom },
  ]

  let ioBusy = false
  let ioError = ''

  /** Light / dark: circular reveal growing from the button's icon. */
  function onThemeClick(e) {
    const ico = e.currentTarget.querySelector('.theme-ico') ?? e.currentTarget
    const b = ico.getBoundingClientRect()
    switchTheme(undefined, { x: b.left + b.width / 2, y: b.top + b.height / 2 })
  }

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

  // ── Keyboard shortcuts (E5) ──────────────────────────────────────────────
  // Ctrl/⌘+Enter: design · Del / Backspace: remove the hovered stage (outside
  // text fields) · Esc: cancels drags (handled where the drag lives).
  const NON_TEXT = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'])
  const typing = el => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !NON_TEXT.has(el.type)))
  function onKeydown(e) {
    if ($gameMode) return            // the game has its own keys
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if ($uiEnabled) runDesign()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing(document.activeElement) && $hoveredStageId != null) {
      e.preventDefault()
      removeStage($hoveredStageId)
      hoveredStageId.set(null)
    }
  }

  // ── Game mode ────────────────────────────────────────────────────────────
  // The designer stays mounted underneath (its state survives a game).
  function enterGame() {
    if ($gameMode || !$uiEnabled) return
    playEnter(() => gameMode.set(true))
  }
  function exitGame() {
    if (!$gameMode) return
    playExit(() => gameMode.set(false))
  }

  let stopLive = null
  onDestroy(() => stopLive?.())

  onMount(async () => {
    stopLive = startLiveMode()
    // Warm the mascot sprites so the first Game press animates right away
    setTimeout(() => initMascot(), 1500)
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
    // Keep bodePoints numeric for the worker (loaded designs may carry strings).
    const pts = Number($bodePoints)
    if (Number.isFinite(pts) && pts !== $bodePoints) bodePoints.set(pts)
    if (!$filterResult || !$filterParams) return
    try {
      const r = freqRangeFromParams($filterParams)
      const api = getWorkerApi()
      bodeData.set(await designBode(api, $filterResult, r.min, r.max, pts || $bodePoints))
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
      if (e?.code === NO_FILE) return
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
      aria-label={$sidebarOpen ? tx.hideSidebar : tx.showSidebar}
      title={$sidebarOpen ? tx.hideSidebar : tx.showSidebar}
      aria-pressed={$sidebarOpen}
    >
      <StableText text={tx.params} variants={all('params')} />
    </button>
    <img class="logo-icon" src="{import.meta.env.BASE_URL}favicon-48x48.png" width="28" height="28" alt="" />
    <span class="logo">FilterTool</span>
    <LoadingBadge />
    <button
      class="header-btn game-btn"
      disabled={!$uiEnabled}
      on:click={enterGame}
      title={tx.gameTitle}
    >
      <span class="game-ico" aria-hidden="true"></span><StableText text={tx.game} variants={all('game')} />
    </button>
    <div class="header-spacer"></div>

    <!-- Bode resolution meter · frequency units (form | plots) -->
    <PointsMeter disabled={!$uiEnabled} warn={pointsWarn} on:change={onPointsChange} />
    <UnitToggles />

    <!-- Cursor · comparison line style · legend, as icons (no text to shift between languages) -->
    <ViewToggles />
    <label class="nav-field" title={tx.colorsTitle}>
      <span class="nav-lbl"><StableText text={tx.colors} variants={all('colors')} align="end" /></span>
      <select class="nav-sel colors" bind:value={$colorMode} on:change={onColorModeChange}>
        {#each COLOR_MODE_OPTIONS as opt}
          <option value={opt.id}>{opt.label}</option>
        {/each}
      </select>
    </label>

    <LangSwitch />
    <button
      class="header-btn theme-btn"
      on:click={onThemeClick}
      aria-label={$theme === 'dark' ? tx.toLight : tx.toDark}
      title={$theme === 'dark' ? tx.toLight : tx.toDark}
    >
      {#key $theme}<span class="theme-ico" aria-hidden="true">{$theme === 'dark' ? '☀️' : '🌙'}</span>{/key}
      <StableText text={$theme === 'dark' ? tx.light : tx.dark} variants={all('light', 'dark')} />
    </button>
    <button
      class="header-btn"
      disabled={!$filterParams || ioBusy}
      on:click={onSave}
      title={$filterParams ? tx.saveTitle : tx.saveNeeds}
    >
      <StableText text={tx.save} variants={all('save')} />
    </button>
    <button
      class="header-btn"
      disabled={!$uiEnabled || ioBusy}
      on:click={onLoad}
      title={tx.loadTitle}
    >
      <StableText text={ioBusy ? tx.loading : tx.load} variants={all('load', 'loading')} />
    </button>
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

{#if $gameMode}
  <GameMode on:exit={exitGame} />
{/if}

<svelte:window on:keydown={onKeydown} />
<Toast />

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
  .icon-btn:hover, .header-btn:hover:not(:disabled) { background: var(--hover); }
  .header-btn:disabled { opacity: 0.4; cursor: default; }

  /* Game mode entry: pixel-font, neandertool colours */
  .game-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-family: 'Press Start 2P', 'Courier New', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    color: #fff;
    background: #0d2035;
    border: 2px solid #8d6e63;
    border-radius: 0;
    box-shadow: 3px 3px 0 #5d4037;
    padding: 0.4rem 0.6rem 0.35rem;
  }
  .game-btn:hover:not(:disabled) { background: #0d2035; border-color: #00bcd4; color: #00bcd4; }
  /* Light theme: same pixel button, paper colours (navy text, cyan hover) */
  :global(:root[data-theme='light']) .game-btn {
    color: #0d2035;
    background: #fdf6e3;
    box-shadow: 3px 3px 0 #bcaaa4;
  }
  :global(:root[data-theme='light']) .game-btn:hover:not(:disabled) {
    background: #e0f7fa;
    border-color: #0097a7;
    color: #00838f;
  }
  :global(:root[data-theme='light']) .game-btn:active:not(:disabled) { box-shadow: 1px 1px 0 #bcaaa4; }
  .game-btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #5d4037; }
  .game-ico {
    width: 8px;
    height: 8px;
    background: #ff9800;
    box-shadow: 0 0 0 2px #5d4037;
    animation: game-coin 1.2s steps(4, end) infinite;
  }
  @keyframes game-coin {
    0%, 100% { transform: scaleX(1); }
    50% { transform: scaleX(0.2); }
  }
  @media (prefers-reduced-motion: reduce) { .game-ico { animation: none; } }

  .theme-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
  }
  .theme-ico {
    font-size: 0.9rem;
    line-height: 1;
    /* Emoji ignore color; keep it from inheriting the muted text tint */
    filter: saturate(1.1);
    animation: theme-ico-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes theme-ico-in {
    from { transform: rotate(-120deg) scale(0.3); opacity: 0; }
    to   { transform: none; opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .theme-ico { animation: none; } }

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
  /* Fits the longest option in either language ("Por defecto") */
  .nav-sel.colors { width: 7.4rem; }

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
