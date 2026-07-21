<script>
  import { stages, filterResult, bodePoints, theme } from '../../stores/app.js'
  import { getWorkerApi } from '../../lib/worker-client.js'
  import BodePlot from '../BodePlot.svelte'

  const COLORS = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166', '#79c0ff', '#ffa657', '#39d353']

  let stageBodes = []
  let computeId  = 0

  // Frequency range derived from the largest pole magnitude (natural frequency).
  $: freqRange = (() => {
    if (!$filterResult?.poles?.length) return { min: 0.1, max: 1e5 }
    const maxOmega = Math.max(...$filterResult.poles.map(([r, i]) => Math.sqrt(r*r + i*i)))
    if (maxOmega < 1e-9) return { min: 0.1, max: 1e5 }
    const fRef = maxOmega / (2 * Math.PI)
    return { min: fRef * 0.01, max: fRef * 100 }
  })()

  $: recompute($stages, freqRange, $bodePoints)

  async function recompute(stageList, range, pts) {
    const id = ++computeId
    if (!stageList.length) { stageBodes = []; return }
    const api = getWorkerApi()
    const results = await Promise.all(
      stageList.map(s => api.computeBode(s.num, s.den, range.min, range.max, pts ?? 1000))
    )
    if (id !== computeId) return
    stageBodes = results
  }

  function toDb(v) {
    if (!(v > 0)) return null
    const db = 20 * Math.log10(v)
    return Number.isFinite(db) ? db : null
  }

  // Cascade = point-wise sum of stage dBs (= product of stage magnitudes).
  // Only shown when every stage has been computed.
  $: cascadeTrace = (() => {
    if (!stageBodes.length || stageBodes.length !== $stages.length || stageBodes.some(b => !b)) return null
    const freq = stageBodes[0].freq
    const dB = freq.map((_, i) => {
      let sum = 0
      for (const sb of stageBodes) {
        const v = toDb(sb.magnitude[i])
        if (v == null) return null
        sum += v
      }
      return sum
    })
    return {
      x: freq, y: dB, mode: 'lines', name: 'Cascade',
      line: { color: $theme === 'light' ? '#24292f' : '#e6edf3', width: 2, dash: 'dot' },
    }
  })()

  $: traces = [
    ...$stages.map((stage, i) => ({
      x: stageBodes[i]?.freq ?? [],
      y: (stageBodes[i]?.magnitude ?? []).map(toDb),
      mode: 'lines',
      name: stage.name,
      line: { color: COLORS[i % COLORS.length], width: 1.5 },
    })),
    ...(cascadeTrace ? [cascadeTrace] : []),
  ]
</script>

{#if $stages.length === 0}
  <div class="empty">
    <p>No stages yet — select poles/zeros in the Pole-Zero tab to build a stage decomposition.</p>
  </div>
{:else}
  <BodePlot {traces} yLabel="$|H(f)|$ [dB]" filename="filtool_stages" />
{/if}

<style>
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    padding: 1.25rem;
  }
  p {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-align: left;
    max-width: 36rem;
    overflow-wrap: anywhere;
    margin: 0;
  }
</style>
