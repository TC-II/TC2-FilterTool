<script>
  // One stage: summary, normalization, editable f0 / Q / gain offset, reset / remove.
  import { createEventDispatcher } from 'svelte'
  import { dataUnit, hoveredStageId, lang } from '../stores/app.js'
  import { TWO_PI } from '../lib/approx.js'
  import { poleSummary, scaleRoots, withQ, normOptions, normLabel, resolveNorm, Q_MIN, Q_MAX } from '../lib/stage-math.js'
  import { editStageLive, flushStageEdit, resetStage, removeStage, isModified, stageName } from '../lib/stages.js'
  import { table, fmt } from '../lib/i18n.js'
  import { normGain } from '../lib/stage-eval.js'
  import { formatSI } from '../lib/si.js'
  import NumField from './form/NumField.svelte'

  export let stage
  export let color
  export let filterType = 0

  const dispatch = createEventDispatcher()

  const TX = {
    en: {
      grip: 'Drag to reorder', edited: 'edited', editedTitle: 'Changed since the stage was built',
      reset: 'Reset to the stage as built', remove: 'Remove stage',
      kTitle: 'Stage gain k (normalization · offset)',
      norm: 'Norm.',
      gain: 'Gain', gainTitle: 'Gain offset on top of the normalization; drag to adjust',
    },
    es: {
      grip: 'Arrastre para reordenar', edited: 'editada', editedTitle: 'Modificada desde que se armó la etapa',
      reset: 'Volver a la etapa como se armó', remove: 'Quitar etapa',
      kTitle: 'Ganancia de la etapa k (normalización · ajuste)',
      norm: 'Norm.',
      gain: 'Ganancia', gainTitle: 'Ajuste de ganancia sobre la normalización; arrastre para ajustar',
      // Normalization choices (lib/stage-math.js normLabel / normProblem, in Spanish)
      normText: {
        'ω→0':  'ganancia unitaria en continua (ω→0)',
        'ω→∞':  'ganancia unitaria en alta frecuencia (ω→∞)',
        'ω→ω0': 'ganancia unitaria en |p| (ω→ω0)',
      },
    },
  }
  $: tx = table(TX, $lang)
  const cap = t => t[0].toUpperCase() + t.slice(1)
  function normText(n, ft, t) {
    if (!t.normText) return normLabel(n, ft)
    if (n === 'Passband') return `Auto: ${t.normText[resolveNorm(n, ft)]}`
    return t.normText[n] ? cap(t.normText[n]) : n
  }

  $: uf       = $dataUnit === 'rad' ? TWO_PI : 1
  $: uLabel   = $dataUnit === 'rad' ? 'rad/s' : 'Hz'
  $: fsym     = $dataUnit === 'rad' ? 'ω' : 'f'
  $: summary  = poleSummary(stage.poles)
  $: f0       = summary.w0 != null ? (summary.w0 / TWO_PI) * uf : null   // data unit
  $: hasQ     = stage.poles.length === 2 && Number.isFinite(summary.q)
  // Live stage gain (same as the engine's): normalization · offset
  $: kLin     = normGain(stage.zeros, stage.poles, stage.normtype, filterType) * Math.pow(10, (stage.gainDb ?? 0) / 20)
  $: gainDb   = kLin > 0 ? 20 * Math.log10(kLin) : null
  $: edited   = isModified(stage)
  $: hovered  = $hoveredStageId === stage.id

  // Local copies for the inputs; pushed to the stage on change.
  let f0Edit, qEdit, gEdit
  $: f0Edit = f0
  $: qEdit  = summary.q
  $: gEdit  = stage.gainDb ?? 0

  function setF0(v) {
    if (!(v > 0) || !(f0 > 0)) return
    const r = v / f0
    editStageLive(stage.id, s => ({ zeros: scaleRoots(s.zeros, r), poles: scaleRoots(s.poles, r) }))
  }
  function setQ(v) {
    if (!(v > 0)) return
    editStageLive(stage.id, s => ({ poles: withQ(s.poles, v) }))
  }
  function setGain(v) {
    if (Number.isFinite(v)) editStageLive(stage.id, { gainDb: v })
  }

  $: if (f0Edit != null && f0 != null && Math.abs(f0Edit / f0 - 1) > 1e-9) setF0(f0Edit)
  $: if (hasQ && qEdit != null && Math.abs(qEdit / summary.q - 1) > 1e-9) setQ(qEdit)
  $: if (gEdit != null && Math.abs(gEdit - (stage.gainDb ?? 0)) > 1e-9) setGain(gEdit)

  const orderText = s => `${s.poles.length}P/${s.zeros.length}Z`
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card"
  class:hovered
  style="--c: {color}"
  on:mouseenter={() => hoveredStageId.set(stage.id)}
  on:mouseleave={() => hoveredStageId.set(null)}
>
  <div class="head">
    <span class="grip" title={tx.grip} on:pointerdown={e => dispatch('grab', e)}>⋮⋮</span>
    <span class="swatch"></span>
    <span class="name">{stageName(stage.name, $lang)}</span>
    {#if edited}<span class="badge" title={tx.editedTitle}>{tx.edited}</span>{/if}
    <span class="spacer"></span>
    <button class="icon" title={tx.reset} disabled={!edited} on:click={() => resetStage(stage.id)}>↺</button>
    <button class="icon danger" title={tx.remove} on:click={() => removeStage(stage.id)}>×</button>
  </div>

  <div class="meta">
    <span>{orderText(stage)}</span>
    {#if f0 != null}<span>{fsym}₀ {formatSI(f0)} {uLabel}</span>{/if}
    {#if hasQ}<span>Q {summary.q.toFixed(3)}</span>{/if}
    {#if gainDb != null}<span title={tx.kTitle}>k {gainDb.toFixed(2)} dB</span>{/if}
  </div>

  <label class="norm">
    <span class="lbl">{tx.norm}</span>
    <select value={stage.normtype ?? 'Passband'} on:change={e => { editStageLive(stage.id, { normtype: e.currentTarget.value }); flushStageEdit() }}>
      <!-- Only the normalizations that work for this stage's roots (and the current one) -->
      {#each normOptions(filterType, stage.zeros, stage.poles, stage.normtype ?? 'Passband') as n}
        <option value={n}>{normText(n, filterType, tx)}</option>
      {/each}
    </select>
  </label>

  <div class="edits">
    {#if f0 != null}
      <NumField layout="stack" label="{fsym}₀" bind:value={f0Edit} unit={uLabel} min={1e-6} max={1e15} on:scrubend={flushStageEdit} />
    {/if}
    {#if hasQ}
      <NumField layout="stack" label="Q" bind:value={qEdit} min={Q_MIN} max={Q_MAX} si={false} on:scrubend={flushStageEdit} />
    {/if}
    <NumField layout="stack" label={tx.gain} bind:value={gEdit} unit="dB" min={-200} max={200} log={false} step={0.5}
      title={tx.gainTitle} on:scrubend={flushStageEdit} />
  </div>
</div>

<style>
  .card {
    border: 1px solid var(--border);
    border-left: 3px solid var(--c);
    border-radius: 5px;
    background: var(--bg);
    padding: 0.4rem 0.5rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    transition: background 0.12s, box-shadow 0.12s;
  }
  .card.hovered {
    background: color-mix(in srgb, var(--c) 10%, var(--bg));
    box-shadow: 0 0 0 1px var(--c);
  }

  .head { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
  .grip {
    cursor: grab; color: var(--text-dim); font-size: 0.7rem; letter-spacing: -2px;
    user-select: none; touch-action: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 1rem; height: 1.2rem; margin-left: -0.2rem; border-radius: 3px;
  }
  .grip:hover { color: var(--text); background: var(--surface-2); }
  .swatch { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--c); flex-shrink: 0; }
  .name { font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge {
    font-size: 0.66rem; padding: 0 0.35rem; border-radius: 999px;
    border: 1px solid var(--warning); color: var(--warning);
  }
  .spacer { flex: 1; }
  .icon {
    background: none; border: 1px solid transparent; border-radius: 3px;
    color: var(--text-dim); cursor: pointer; font-size: 0.9rem; line-height: 1; padding: 0.05rem 0.3rem;
  }
  .icon:hover:not(:disabled) { color: var(--text); border-color: var(--border); }
  .icon.danger:hover { color: var(--danger); }
  .icon:disabled { opacity: 0.3; cursor: default; }

  .meta {
    display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem;
    font-size: 0.74rem; color: var(--text-muted);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  }

  .norm { display: flex; align-items: center; gap: 0.4rem; }
  .lbl { font-size: 0.78rem; color: var(--text-muted); }
  select {
    flex: 1; min-width: 0;
    background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
    color: var(--text); font-size: 0.78rem; padding: 0.2rem 0.3rem; outline: none;
  }
  select:focus { border-color: var(--accent); }

  .edits {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
  }
</style>
