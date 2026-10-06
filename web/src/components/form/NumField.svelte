<script>
  // Labelled numeric field: drag the label to scrub, wheel/arrows while focused,
  // SI-prefix entry (SciInput), inline validation hint.
  import SciInput from '../SciInput.svelte'
  import { createEventDispatcher } from 'svelte'
  import { scrub } from '../../lib/scrub.js'
  import { hoveredFields, lang } from '../../stores/app.js'
  import { table, fmt } from '../../lib/i18n.js'

  const TX = {
    en: { drag: 'Drag to adjust {label}{per}; Shift = fine', per: ' ({step} {unit} per 4 px)' },
    es: { drag: 'Arrastre para ajustar {label}{per}; Shift = fino', per: ' ({step} {unit} cada 4 px)' },
  }
  $: tx = table(TX, $lang)

  export let label
  export let value
  export let unit = ''
  export let min = -Infinity
  export let max = Infinity
  /** Log (×/÷) nudging and scrubbing — frequencies, times. Otherwise linear by `step`. */
  export let log = true
  export let step = 1
  /** SI-prefix display; defaults to on for log (frequency) fields, off for dB / % / linear. */
  export let si = log
  /** Validation message for this field, or '' / undefined. */
  export let error = ''
  /** false: only outline the field; the parent shows the message (narrow rows). */
  export let showHint = true
  /** 'row' = label beside the input, 'stack' = label above. */
  export let layout = 'row'
  export let title = ''
  /** Template edge this field controls (hover link with the plot), e.g. 'fp', 'apDb'. */
  export let edge = null
  /** Edge colour group: 'pass' | 'stop' | 'centre'. */
  export let group = null

  const dispatch = createEventDispatcher()
  let ownHover = false
  function enter() { if (edge) { hoveredFields.set([edge]); ownHover = true } }
  function leave() { if (ownHover) { hoveredFields.set([]); ownHover = false } }

  $: linked = !!edge && $hoveredFields.includes(edge)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="nf {layout}" class:linked on:mouseenter={enter} on:mouseleave={leave}>
  <span
    class="lbl"
    title={title || fmt(tx.drag, { label, per: log ? '' : fmt(tx.per, { step, unit }) })}
    use:scrub={{ get: () => value, set: v => (value = v), done: () => dispatch('scrubend'), log, step, min, max }}
  >{#if group}<i class="mark {group}" aria-hidden="true"></i>{/if}{label}</span>
  <SciInput bind:value {unit} {min} {max} {si} logNudge={log} {step} invalid={!!error} on:change />
  {#if error && showHint}<span class="hint">{error}</span>{/if}
</div>

<style>
  .nf {
    min-width: 0;
    border-radius: 4px;
    transition: box-shadow 0.12s, background 0.12s;
  }
  .nf.linked {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .mark {
    display: inline-block;
    width: 3px;
    height: 0.8em;
    border-radius: 2px;
    margin-right: 0.35rem;
    vertical-align: -0.05em;
  }
  .mark.pass   { background: var(--success); }
  .mark.stop   { background: var(--warning); }
  .mark.centre { background: var(--text-dim); }
  .nf.linked .mark { width: 4px; }
  .nf.row {
    display: grid;
    grid-template-columns: var(--lbl-w, 5.5rem) minmax(0, 1fr);
    align-items: center;
    column-gap: 0.45rem;
    row-gap: 0.2rem;
  }
  .nf.stack {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .lbl {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
    touch-action: none;
  }
  .lbl:global(.scrubbable) { cursor: ew-resize; }
  .lbl:global(.scrubbable):hover { color: var(--accent); }
  .lbl:global(.scrubbing) { color: var(--accent); text-decoration: underline dotted; }

  .hint {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--danger);
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .nf.row .hint { grid-column: 2; }
</style>
