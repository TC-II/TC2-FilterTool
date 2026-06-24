<script>
  import { activeTab } from '../stores/app.js'

  const TABS = [
    { id: 'magnitude',  label: 'Magnitude' },
    { id: 'phase',      label: 'Phase' },
    { id: 'groupDelay', label: 'Group Delay' },
    { id: 'poleZero',   label: 'Pole-Zero' },
    { id: 'stages',     label: 'Stages' },
  ]
</script>

<nav class="tabbar" role="tablist">
  {#each TABS as tab}
    <button
      role="tab"
      aria-selected={$activeTab === tab.id}
      class:active={$activeTab === tab.id}
      on:click={() => activeTab.set(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #21262d;
    padding: 0 1rem;
    background: #161b22;
    flex-shrink: 0;
  }

  button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #7d8590;
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0.6rem 1rem;
    margin-bottom: -1px;
    transition: color 0.15s, border-color 0.15s;
  }
  button:hover { color: #c9d1d9; }
  button.active {
    color: #e6edf3;
    border-bottom-color: #58a6ff;
  }
</style>
