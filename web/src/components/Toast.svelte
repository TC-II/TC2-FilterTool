<script>
  // Single transient notice (stores/app.js `toast`), bottom centre, with an
  // optional action button (e.g. Undo). Auto-dismisses after timeoutMs.
  import { onDestroy } from 'svelte'
  import { toast, lang } from '../stores/app.js'

  const DISMISS = { en: 'Dismiss', es: 'Cerrar' }

  let timer = null
  $: schedule($toast)

  function schedule(t) {
    clearTimeout(timer)
    if (t) timer = setTimeout(() => toast.set(null), t.timeoutMs ?? 6000)
  }

  function act() {
    const t = $toast
    toast.set(null)
    t?.onAction?.()
  }

  onDestroy(() => clearTimeout(timer))
</script>

{#if $toast}
  <div class="toast" role="status" aria-live="polite">
    <span class="msg">{$toast.message}</span>
    {#if $toast.actionLabel}
      <button class="act" on:click={act}>{$toast.actionLabel}</button>
    {/if}
    <button class="x" aria-label={DISMISS[$lang] ?? DISMISS.en} on:click={() => toast.set(null)}>×</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.2rem;
    transform: translateX(-50%);
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: min(90vw, 36rem);
    padding: 0.5rem 0.6rem 0.5rem 0.9rem;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
    color: var(--text);
    font-size: 0.85rem;
  }
  .msg { flex: 1; min-width: 0; }
  .act {
    background: var(--accent-strong);
    border: none;
    border-radius: 4px;
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.25rem 0.7rem;
  }
  .act:hover { background: var(--accent-hover); }
  .x {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 0.2rem;
  }
  .x:hover { color: var(--text); }
</style>
