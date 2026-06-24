<script>
  import { uiEnabled } from '../stores/app.js'
  import FilterPanel  from './FilterPanel.svelte'
  import ComparePanel from './ComparePanel.svelte'
</script>

<aside class="sidebar" class:disabled={!$uiEnabled} aria-disabled={!$uiEnabled}>
  <section class="section">
    <h3 class="section-title">Filter Design</h3>
    <FilterPanel />
  </section>

  <section class="section">
    <h3 class="section-title">Compare</h3>
    <ComparePanel />
  </section>

  <section class="section">
    <h3 class="section-title">Datasets</h3>
    <p class="placeholder">Dataset import — Phase 7</p>
  </section>

  <section class="section">
    <h3 class="section-title">Datalines</h3>
    <p class="placeholder">Dataline list — Phase 7</p>
  </section>
</aside>

<style>
  .sidebar {
    width: 300px;
    min-width: 300px;
    background: #161b22;
    border-right: 1px solid #21262d;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    transition: opacity 0.2s;
  }
  .sidebar.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .section {
    border-bottom: 1px solid #21262d;
  }
  .section-title {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7d8590;
    margin: 0;
    padding: 0.6rem 0.75rem 0.4rem;
  }
  .placeholder {
    font-size: 0.78rem;
    color: #30363d;
    padding: 0.75rem;
    margin: 0;
  }
</style>
