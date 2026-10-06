<script>
  import { createEventDispatcher } from 'svelte'

  /** @type {{ value: any, label: string, html?: string, title?: string, glyph?: string }[]} */
  export let options = []
  export let value
  export let ariaLabel = ''
  /** 'sm' = compact inline control (e.g. in a section header): a pill with a sliding thumb. */
  export let size = 'md'

  const dispatch = createEventDispatcher()

  function pick(v) {
    if (v === value) return
    value = v
    dispatch('change', v)
  }

  // Roving arrow-key selection, like a native radio group.
  function onKeydown(e) {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = options.findIndex(o => o.value === value)
    const next = options[(i + dir + options.length) % options.length]
    pick(next.value)
    e.currentTarget.querySelector(`[data-i="${options.indexOf(next)}"]`)?.focus()
  }
</script>

<!-- svelte-ignore a11y-interactive-supports-focus -->
<div
  class="seg"
  class:sm={size === 'sm'}
  role="radiogroup"
  aria-label={ariaLabel}
  style:--n={options.length}
  style:--i={Math.max(0, options.findIndex(o => o.value === value))}
  on:keydown={onKeydown}
>
  {#if size === 'sm'}<span class="thumb" aria-hidden="true"></span>{/if}
  {#each options as o, i}
    <button
      type="button"
      role="radio"
      data-i={i}
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      class:on={o.value === value}
      class:has-glyph={!!o.glyph}
      title={o.title ?? o.label}
      on:click={() => pick(o.value)}
    >
      {#if o.glyph}
        <svg viewBox="0 0 24 12" aria-hidden="true"><path d={o.glyph} /></svg>
      {/if}
      {#if o.html}<span>{@html o.html}</span>{:else}<span>{o.label}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px;
    gap: 2px;
    min-width: 0;
  }

  button {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--text-dim);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.28rem 0.2rem;
    white-space: nowrap;
  }
  button:hover:not(.on) { background: var(--surface-2); color: var(--text-muted); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button.on {
    background: var(--selected);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /* Compact: equal-width segments, one thumb sliding between them (like the
     header's unit / language switches) */
  .seg.sm {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 0;
    height: 1.4rem;
    padding: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    flex-shrink: 0;
  }
  .seg.sm .thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--n));
    transform: translateX(calc(var(--i) * 100%));
    border-radius: 3px;
    background: var(--selected);
    box-shadow: inset 0 0 0 1px var(--accent);
    transition: transform 0.18s ease-out;
  }
  .seg.sm button {
    position: relative;
    flex-direction: row;
    padding: 0 0.55rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    transition: color 0.15s;
  }
  .seg.sm button:hover:not(.on) { background: transparent; color: var(--text-muted); }
  .seg.sm button.on { background: transparent; box-shadow: none; color: var(--accent); font-weight: 700; }
  .seg.sm :global(i) { font-family: 'Times New Roman', Georgia, serif; font-size: 0.85rem; font-weight: 400; }
  .seg.sm :global(sub) { font-size: 0.6rem; line-height: 0; vertical-align: baseline; position: relative; top: 0.12em; margin-left: 0.05em; }
  @media (prefers-reduced-motion: reduce) { .seg.sm .thumb { transition: none; } }

  svg {
    width: 1.5rem;
    height: 0.75rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
