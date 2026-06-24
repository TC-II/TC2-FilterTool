<script>
  import { filterParams, filterResult, comparisons, bodePoints } from '../stores/app.js'
  import { getWorkerApi } from '../lib/worker-client.js'
  import { APPROX_NAMES, APPROX_COLORS, freqRangeFromParams } from '../lib/approx.js'

  let selectedApproxes = new Set()
  let useMainN = false
  let computing = false
  let computeId = 0

  $: mainApproxType = $filterParams?.approx_type ?? -1

  // Recompute whenever any dependency changes
  $: triggerRecompute($filterParams, $filterResult, selectedApproxes, useMainN, $bodePoints)

  async function triggerRecompute(params, mainResult, selected, sameN, pts) {
    const id = ++computeId
    if (!params || selected.size === 0) { comparisons.set([]); return }

    computing = true
    try {
      const api = getWorkerApi()
      const range = freqRangeFromParams(params)

      const results = await Promise.all(
        [...selected].map(async (approxType) => {
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
    const s = new Set(selectedApproxes)
    if (s.has(idx)) s.delete(idx)
    else s.add(idx)
    selectedApproxes = s
  }
</script>

{#if !$filterParams}
  <p class="hint">Design a filter first.</p>
{:else}
  <div class="mode-row">
    <label class="mode-opt">
      <input type="radio" bind:group={useMainN} value={false} />
      Min N
    </label>
    <label class="mode-opt">
      <input type="radio" bind:group={useMainN} value={true} />
      Same N ({$filterResult?.N ?? '?'})
    </label>
    {#if computing}
      <span class="spin" aria-hidden="true"></span>
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
          <span class="swatch" style="background: {APPROX_COLORS[i]}"></span>
          <span class="aname">{name}</span>
          {#if $comparisons.find(c => c.approxType === i)}
            <span class="n-tag">N={$comparisons.find(c => c.approxType === i).filterResult.N}</span>
          {/if}
        </label>
      {:else}
        <div class="approx-row main-row">
          <span class="swatch" style="background: {APPROX_COLORS[i]}"></span>
          <span class="aname">{name}</span>
          <span class="n-tag main">N={$filterResult?.N ?? '?'} ★</span>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .hint { font-size: 0.78rem; color: #484f58; padding: 0.5rem 0.75rem; margin: 0; }

  .mode-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem 0.3rem;
    flex-wrap: wrap;
  }

  .mode-opt {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: #c9d1d9;
    cursor: pointer;
    user-select: none;
  }
  .mode-opt input { accent-color: #58a6ff; cursor: pointer; }

  .spin {
    width: 8px; height: 8px;
    border: 1.5px solid #7d8590;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .approx-list {
    display: flex;
    flex-direction: column;
    padding: 0 0.4rem 0.5rem;
  }

  .approx-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.22rem 0.35rem;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    font-size: 0.78rem;
    color: #c9d1d9;
  }
  .approx-row:hover:not(.main-row) { background: #21262d; }
  .approx-row.sel { background: #1c2d4a; }
  .approx-row input { accent-color: #58a6ff; cursor: pointer; }

  .main-row { cursor: default; opacity: 0.55; }

  .swatch {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .aname { flex: 1; }

  .n-tag {
    font-size: 0.67rem;
    color: #7d8590;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .n-tag.main { color: #58a6ff; }
</style>
