<script>
  import { activeTab, lang } from '../stores/app.js'

  const TAB_IDS = ['magnitude', 'template', 'phase', 'groupDelay', 'step', 'impulse', 'poleZero', 'stages']
  const LABELS = {
    en: ['Magnitude', 'Template', 'Phase', 'Group Delay', 'Step', 'Impulse', 'Pole-Zero', 'Stages'],
    es: ['Módulo', 'Plantilla', 'Fase', 'Retardo de grupo', 'Escalón', 'Impulso', 'Polos y ceros', 'Etapas'],
  }
  $: TABS = TAB_IDS.map((id, i) => ({ id, label: (LABELS[$lang] ?? LABELS.en)[i] }))
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
