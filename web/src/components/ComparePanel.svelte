<script>
  import { filterParams, filterResult, comparisons, bodePoints, theme, colorMode, colorShuffle, compareApproxes, compareSameN } from '../stores/app.js'
  import { getWorkerApi } from '../lib/worker-client.js'
  import { APPROX_NAMES, plotColor, freqRangeFromParams } from '../lib/approx.js'

  let computing = false
  let computeId = 0

  $: mainApproxType = $filterParams?.approx_type ?? -1
  $: selectedApproxes = new Set($compareApproxes)

  // Drop the main approx if it becomes selected after a redesign / load.
  $: if (mainApproxType >= 0 && $compareApproxes.includes(mainApproxType)) {
    compareApproxes.set($compareApproxes.filter(a => a !== mainApproxType))
  }

  // Recompute whenever any dependency changes
  $: triggerRecompute($filterParams, $filterResult, $compareApproxes, $compareSameN, $bodePoints)

  async function triggerRecompute(params, mainResult, selected, sameN, pts) {
    const id = ++computeId
    const sel = selected ?? []
    if (!params || sel.length === 0) { comparisons.set([]); return }

    computing = true
    try {
      const api = getWorkerApi()
      const range = freqRangeFromParams(params)

      const results = await Promise.all(
        sel.map(async (approxType) => {
          const p = { ...params, approx_type: approxType }
          if (sameN && mainResult?.N) {
            p.N_min = mainResult.N
            p.N_max = mainResult.N
          }
          const fr = await api.filterDesign(p)
          if (fr.error) return null
          const bode = await api.computeBode(fr.num, fr.den, range.min, range.max, pts ?? 2000)
          return { approxType, filterResult: fr, bodeData: bode }
        })
      )

      if (id !== computeId) return
      comparisons.set(results.filter(Boolean))
    } catch (_) {
      if (id === computeId) comparisons.set([])
    } finally {
      if (id === computeId) computing = false
    }
  }

  function toggle(idx) {
    const cur = $compareApproxes
    compareApproxes.set(cur.includes(idx) ? cur.filter(a => a !== idx) : [...cur, idx])
  }
</script>

{#if !$filterParams}
  <p class="hint">Design a filter first.</p>
{:else}
  <div class="mode">
    <span class="mode-lbl">Order</span>
    <div class="mode-opts" role="radiogroup" aria-label="Comparison order">
      <label class="mode-opt" class:on={!$compareSameN}>
        <input type="radio" bind:group={$compareSameN} value={false} />
        Min N
      </label>
      <label class="mode-opt" class:on={$compareSameN}>
        <input type="radio" bind:group={$compareSameN} value={true} />
        Same N ({$filterResult?.N ?? '?'})
      </label>
    </div>
    {#if computing}
      <span class="spin" aria-hidden="true" title="Computing comparisons"></span>
    {/if}
  </div>

  <div class="approx-list">
    {#each APPROX_NAMES as name, i}
      {#if i !== mainApproxType}
        <label class="approx-row" class:sel={selectedApproxes.has(i)}>
          <input
            type="checkbox"
            checked={selectedApproxes.has(i)}
            on:change={() => toggle(i)}
          />
          <span class="swatch" style="background: {plotColor(i, $theme, $colorMode, $colorShuffle)}"></span>
          <span class="aname">{name}</span>
          {#if $comparisons.find(c => c.approxType === i)}
            <span class="n-tag">N={$comparisons.find(c => c.approxType === i).filterResult.N}</span>
          {/if}
        </label>
      {:else}
        <div class="approx-row main-row">
          <span class="check-spacer" aria-hidden="true"></span>
          <span class="swatch" style="background: {plotColor(i, $theme, $colorMode, $colorShuffle)}"></span>
          <span class="aname">{name}</span>
          <span class="n-tag main">N={$filterResult?.N ?? '?'} ★</span>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .hint {
    font-size: 0.85rem;
    color: var(--disabled);
    padding: 0.5rem 0.7rem;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .mode {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.7rem 0.4rem;
  }

  .mode-lbl {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .mode-opts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem;
    min-width: 0;
  }

  .mode-opt {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    font-size: 0.82rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    padding: 0.35rem 0.4rem;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 4px;
    min-width: 0;
    text-align: center;
  }
  .mode-opt.on {
    border-color: var(--accent);
    background: var(--selected);
    color: var(--text);
  }
  .mode-opt input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .spin {
    width: 10px; height: 10px;
    border: 1.5px solid var(--text-dim);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .approx-list {
    display: flex;
    flex-direction: column;
    padding: 0 0.45rem 0.55rem;
    gap: 0.1rem;
  }

  .approx-row {
    display: grid;
    grid-template-columns: 1rem 0.6rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0.32rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    font-size: 0.88rem;
    color: var(--text-muted);
    min-width: 0;
  }
  .approx-row:hover:not(.main-row) { background: var(--surface-2); }
  .approx-row.sel { background: var(--selected); }
  .approx-row input {
    accent-color: var(--accent);
    cursor: pointer;
    margin: 0;
    width: 1rem;
    height: 1rem;
  }

  .check-spacer {
    width: 1rem;
    height: 1rem;
  }

  .main-row { cursor: default; opacity: 0.6; }

  .swatch {
    width: 9px; height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    justify-self: center;
  }

  .aname {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .n-tag {
    font-size: 0.78rem;
    color: var(--text-dim);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  }
  .n-tag.main { color: var(--accent); }
</style>
