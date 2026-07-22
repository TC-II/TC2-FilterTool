<script>
  import { activeTab } from '../stores/app.js'

  const TABS = [
    { id: 'magnitude',  label: 'Magnitude' },
    { id: 'template',   label: 'Template' },
    { id: 'phase',      label: 'Phase' },
    { id: 'groupDelay', label: 'Group Delay' },
    { id: 'step',       label: 'Step' },
    { id: 'impulse',    label: 'Impulse' },
    { id: 'poleZero',   label: 'Pole-Zero' },
    { id: 'stages',     label: 'Stages' },
  ]
</script>

<div class="tabbar" role="tablist">
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
</div>

<style>
  .tabbar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--surface-2);
    padding: 0 0.5rem;
    background: var(--surface);
    flex-shrink: 0;
    overflow-x: auto;
    overflow-y: hidden;
    min-width: 0;
  }

  button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.88rem;
    padding: 0.55rem 0.85rem;
    margin-bottom: -1px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  button:hover { color: var(--text-muted); }
  button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
</style>
