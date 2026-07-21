<script>
  import { uiEnabled } from '../stores/app.js'
  import FilterPanel  from './FilterPanel.svelte'
  import ComparePanel from './ComparePanel.svelte'
</script>

<aside class="sidebar" class:disabled={!$uiEnabled}>
  <section class="section">
    <h3 class="section-title">Filter Design</h3>
    <FilterPanel />
  </section>

  <section class="section">
    <h3 class="section-title">Compare</h3>
    <ComparePanel />
  </section>
</aside>

<style>
  .sidebar {
    width: 300px;
    min-width: 300px;
    max-width: 100%;
    background: var(--surface);
    border-right: 1px solid var(--surface-2);
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .sidebar.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .section {
    border-bottom: 1px solid var(--surface-2);
  }
  .section-title {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
    margin: 0;
    padding: 0.6rem 0.7rem 0.35rem;
  }

  @media (max-width: 720px) {
    .sidebar {
      width: 100%;
      min-width: 0;
      max-height: 42vh;
      border-right: none;
      border-bottom: 1px solid var(--surface-2);
    }
  }
</style>
