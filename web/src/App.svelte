<script>
  import { onMount } from 'svelte'
  import { proxy } from 'comlink'
  import { getWorkerApi } from './lib/worker-client.js'
  import {
    pyodideReady, pyodideError, pyodideStatus, pyodideProgress,
    activeTab,
  } from './stores/app.js'
  import LoadingBadge  from './components/LoadingBadge.svelte'
  import TabBar        from './components/TabBar.svelte'
  import Sidebar       from './components/Sidebar.svelte'
  import MagnitudeTab  from './components/tabs/MagnitudeTab.svelte'
  import PhaseTab      from './components/tabs/PhaseTab.svelte'
  import GroupDelayTab from './components/tabs/GroupDelayTab.svelte'
  import PoleZeroTab   from './components/tabs/PoleZeroTab.svelte'
  import StagesTab     from './components/tabs/StagesTab.svelte'

  onMount(async () => {
    try {
      const api = getWorkerApi()
      await api.init(
        import.meta.env.BASE_URL,
        proxy((pct, status) => {
          pyodideProgress.set(pct)
          if (status) pyodideStatus.set(status)
        }),
      )
      pyodideProgress.set(100)
      pyodideReady.set(true)
      pyodideStatus.set('Ready')
    } catch (err) {
      pyodideError.set(err.message)
      console.error(err)
    }
  })
</script>

<div class="app">
  <header>
    <span class="logo">FilterTool</span>
    <LoadingBadge />
    <div class="header-spacer"></div>
    <button class="header-btn" disabled>Save</button>
    <button class="header-btn" disabled>Load</button>
  </header>

  <div class="body">
    <Sidebar />

    <div class="content">
      <TabBar />
      <div class="plot-area">
        {#if $activeTab === 'magnitude'}
          <MagnitudeTab />
        {:else if $activeTab === 'phase'}
          <PhaseTab />
        {:else if $activeTab === 'groupDelay'}
          <GroupDelayTab />
        {:else if $activeTab === 'poleZero'}
          <PoleZeroTab />
        {:else if $activeTab === 'stages'}
          <StagesTab />
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%;
    background: #0d1117;
    color: #e6edf3;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }
  :global(#app) { height: 100%; }

  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 1024px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1rem;
    height: 44px;
    background: #161b22;
    border-bottom: 1px solid #21262d;
    flex-shrink: 0;
  }
  .logo {
    font-size: 0.9rem;
    font-weight: 700;
    color: #58a6ff;
    letter-spacing: 0.02em;
  }
  .header-spacer { flex: 1; }
  .header-btn {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #c9d1d9;
    cursor: pointer;
    font-size: 0.78rem;
    padding: 0.25rem 0.75rem;
  }
  .header-btn:hover:not(:disabled) { background: #30363d; }
  .header-btn:disabled { opacity: 0.4; cursor: default; }

  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .plot-area {
    flex: 1;
    overflow: hidden;
  }
</style>
