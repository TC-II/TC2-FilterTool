<script>
  import { designForm, filterParams, filterResult, comparisons, bodePoints, theme, colorMode, colorShuffle, compareApproxes, compareSameN, liveAdjusting } from '../stores/app.js'
  import { getWorkerApi, runInSlot, abortSlot, ABORT_AFTER_MS } from '../lib/worker-client.js'
  import { onDestroy } from 'svelte'
  import { designBode } from '../lib/zpk-bode.js'
  import { APPROX_NAMES, plotColor, freqRangeFromParams } from '../lib/approx.js'
  import { GD, MAX_ORDER, allowedApprox } from '../lib/params.js'
  import Segmented from './form/Segmented.svelte'
  import { lang } from '../stores/app.js'
  import { table, fmt, approxName } from '../lib/i18n.js'
  import { maxPoleQ } from '../lib/stage-math.js'

  const TX = {
    en: {
      compare: 'Compare', computing: 'Computing comparisons',
      minN: 'Min N', minNHtml: '<i>N</i><sub>min</sub>', sameNHtml: '<i>N</i> = {n}', minNTitle: 'Each comparison at its own minimum order for the template',
      sameN: 'Same N ({n})', sameNTitle: 'Every comparison at the main filter\'s order',
      orderAria: 'Comparison order',
      waiting: 'Waiting for a valid template…',
      mainTitle: 'Main filter (change it with the tiles above)',
      main: 'Main', max: 'max',
      maxTitle: 'Order capped at the maximum (N = {max}): the template may not be met',
      order: 'Order N = {n}', qmax: 'highest pole Q = {q}',
      hide: 'Hide {name}', overlay: 'Overlay {name}', gdNA: '{name}: not available for group delay', magNA: '{name}: only for low-pass and group delay',
    },
    es: {
      compare: 'Comparar', computing: 'Calculando comparaciones',
      minN: 'N mín.', minNHtml: '<i>N</i><sub>mín</sub>', sameNHtml: '<i>N</i> = {n}', minNTitle: 'Cada comparación con su propio orden mínimo para la plantilla',
      sameN: 'Mismo N ({n})', sameNTitle: 'Todas las comparaciones con el orden del filtro principal',
      orderAria: 'Orden de las comparaciones',
      waiting: 'Esperando una plantilla válida…',
      mainTitle: 'Filtro principal (se cambia con los mosaicos de arriba)',
      main: 'Ppal', max: 'máx.',
      maxTitle: 'Orden limitado al máximo (N = {max}): puede que no se cumpla la plantilla',
      order: 'Orden N = {n}', qmax: 'Q máximo de los polos = {q}',
      hide: 'Ocultar {name}', overlay: 'Superponer {name}', gdNA: '{name}: no disponible para retardo de grupo', magNA: '{name}: solo para pasa-bajos y retardo de grupo',
    },
  }
  $: tx = table(TX, $lang)
  $: maxTitle = fmt(tx.maxTitle, { max: MAX_ORDER })

  // Highest pole Q of a design: how hard its sharpest stage is to build
  function fmtQ(q) {
    if (q == null) return '?'
    if (!Number.isFinite(q)) return '∞'
    return q < 10 ? q.toFixed(2) : q < 100 ? q.toFixed(1) : q.toFixed(0)
  }
  $: orderTitle = (n, q) => `${fmt(tx.order, { n: n ?? '?' })} · ${fmt(tx.qmax, { q: fmtQ(q) })}`

  let computing = false
  let computeId = 0

  $: mainApproxType = $filterParams?.approx_type ?? -1
  // GD designs only support Bessel / Gauss, HP / BP / BR everything but them;
  // other selections are kept but skipped (they come back when the type changes).
  // Availability follows the form, not the last design: when a new design fails
  // (Bessel LP can't meet most templates) the old one stays, and its type would
  // keep the other approximations locked. Comparisons still compute against the design.
  $: allowed = allowedApprox($designForm.filterType)
  $: naText = $designForm.filterType === GD ? tx.gdNA : tx.magNA
  const can = (i, allow) => !allow || allow.has(i)
  $: selectedApproxes = new Set($compareApproxes)

  // Drop the main approx if it becomes selected after a redesign / load.
  $: if (mainApproxType >= 0 && $compareApproxes.includes(mainApproxType)) {
    compareApproxes.set($compareApproxes.filter(a => a !== mainApproxType))
  }

  // Recompute whenever any dependency changes; while a live control is held
  // (denorm slider) keep the old comparisons and catch up on release.
  $: if (!$liveAdjusting) triggerRecompute($filterParams, $filterResult, $compareApproxes, $compareSameN, $bodePoints)

  // One killable worker per comparison (lib/worker-client.js): deselecting an
  // approximation, or a new design, aborts its calculation if it is still running
  // (a Bessel design can run for seconds), while the others carry on. A request
  // with unchanged inputs reuses the running / finished one.
  const flights = new Map()   // approxType → { key, done, promise }
  const slotOf = a => `cmp:${a}`

  function flightFor(approxType, p, range, pts) {
    const key = JSON.stringify([p, pts])
    const cur = flights.get(approxType)
    if (cur?.key === key) return cur.promise
    if (cur && !cur.done) abortSlot(slotOf(approxType), ABORT_AFTER_MS)
    const f = { key, done: false, promise: null }
    f.promise = (async () => {
      try {
        const fr = await runInSlot(slotOf(approxType), a => a.filterDesign(p))
        if (fr.error) return null
        const bode = await designBode(getWorkerApi(), fr, range.min, range.max, pts ?? 2000)
        return { approxType, filterResult: fr, bodeData: bode }
      } catch (e) {
        if (flights.get(approxType) === f) flights.delete(approxType)   // don't cache a failure / abort
        throw e
      } finally {
        f.done = true
      }
    })()
    flights.set(approxType, f)
    return f.promise
  }

  /** Abort and forget every comparison not in `keep`. */
  function dropFlights(keep) {
    for (const [a, f] of flights) {
      if (keep.has(a)) continue
      if (!f.done) abortSlot(slotOf(a), ABORT_AFTER_MS)
      flights.delete(a)
    }
  }
  onDestroy(() => dropFlights(new Set()))

  async function triggerRecompute(params, mainResult, selected, sameN, pts) {
    const id = ++computeId
    const allow = allowedApprox(params?.filter_type)
    const sel = (selected ?? []).filter(a => can(a, allow))
    dropFlights(new Set(params ? sel : []))
    // (a superseded call's `finally` no longer clears the spinner: do it here)
    if (!params || sel.length === 0) { comparisons.set([]); computing = false; return }

    computing = true
    try {
      const range = freqRangeFromParams(params)

      const results = await Promise.all(
        sel.map(approxType => {
          const p = { ...params, approx_type: approxType }
          if (sameN && mainResult?.N) {
            p.N_min = mainResult.N
            p.N_max = mainResult.N
          }
          return flightFor(approxType, p, range, pts)
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

<div class="cp">
  <div class="group group-row">
    <span>{tx.compare}{#if computing}<span class="spin" aria-hidden="true" title={tx.computing}></span>{/if}</span>
    {#if $filterParams}
      <Segmented
        size="sm"
        options={[
          { value: false, label: tx.minN, html: tx.minNHtml, title: tx.minNTitle },
          { value: true, label: fmt(tx.sameN, { n: $filterResult?.N ?? '?' }), html: fmt(tx.sameNHtml, { n: $filterResult?.N ?? '?' }), title: tx.sameNTitle },
        ]}
        bind:value={$compareSameN}
        ariaLabel={tx.orderAria}
      />
    {/if}
  </div>

  {#if !$filterParams}
    <p class="hint">{tx.waiting}</p>
  {:else}
    <div class="approx-list">
      {#each APPROX_NAMES as _, i}
        {@const name = approxName(i, $lang)}
        {@const c = plotColor(i, $theme, $colorMode, $colorShuffle)}
        {#if i === mainApproxType}
          {@const n = $filterResult?.N}
          {@const q = maxPoleQ($filterResult?.poles)}
          <div class="approx-row main-row" style="--c: {c}" title={tx.mainTitle}>
            <span class="main-chip">{tx.main}</span>
            <span class="swatch" style="background: {c}"></span>
            <span class="aname">{name}</span>
            {#if n === MAX_ORDER}<span class="max-tag" title={maxTitle}>{tx.max}</span>{/if}
            <span class="order main" title={orderTitle(n, q)}>
              <span class="n"><i>N</i>{n ?? '?'}</span>
              <span class="n q"><i>Q</i>{fmtQ(q)}</span>
            </span>
          </div>
        {:else}
          {@const on = selectedApproxes.has(i) && can(i, allowed)}
          {@const cmp = $comparisons.find(x => x.approxType === i)}
          <label class="approx-row" class:sel={on} class:off={!can(i, allowed)} style="--c: {c}"
            title={can(i, allowed) ? fmt(on ? tx.hide : tx.overlay, { name }) : fmt(naText, { name })}>
            <input
              type="checkbox"
              checked={on}
              disabled={!can(i, allowed)}
              on:change={() => toggle(i)}
            />
            <span class="swatch" style="background: {c}"></span>
            <span class="aname">{name}</span>
            {#if on && cmp}
              {#if cmp.filterResult.N === MAX_ORDER}<span class="max-tag" title={maxTitle}>{tx.max}</span>{/if}
              {@const q = maxPoleQ(cmp.filterResult.poles)}
              <span class="order" title={orderTitle(cmp.filterResult.N, q)}>
                <span class="n"><i>N</i>{cmp.filterResult.N}</span>
                <span class="n q"><i>Q</i>{fmtQ(q)}</span>
              </span>
            {/if}
          </label>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Same language as the Specs / Template / Output groups and the approximation tiles */
  .cp {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.5rem 0.7rem 0.75rem;
  }
  .group {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    padding-bottom: 0.15rem;
    border-bottom: 1px solid var(--surface-2);
  }
  .group-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; min-height: 1.35rem; }
  .group-row > span { display: inline-flex; align-items: center; gap: 0.4rem; }

  .hint {
    font-size: 0.82rem;
    color: var(--disabled);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .spin {
    width: 9px; height: 9px;
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
    gap: 0.25rem;
  }

  .approx-row {
    display: grid;
    grid-template-columns: 2.4rem 0.6rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    cursor: pointer;
    user-select: none;
    font-size: 0.85rem;
    color: var(--text-muted);
    min-width: 0;
    transition: border-color 0.12s, background 0.12s;
  }
  .approx-row:hover:not(.main-row):not(.off):not(.sel) {
    background: var(--surface-2);
    border-color: color-mix(in srgb, var(--c) 55%, var(--border));
  }
  .approx-row.sel {
    background: color-mix(in srgb, var(--c) 10%, var(--bg));
    border-color: color-mix(in srgb, var(--c) 70%, var(--border));
    color: var(--text);
  }
  /* Drawn checkbox (native ones keep the old theme's look after a switch) */
  .approx-row input {
    appearance: none;
    -webkit-appearance: none;
    display: grid;
    place-content: center;
    justify-self: center;
    width: 0.95rem;
    height: 0.95rem;
    margin: 0;
    border: 1.5px solid color-mix(in srgb, var(--c) 55%, var(--border));
    border-radius: 3px;
    background: var(--bg);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .approx-row input::after {
    content: '';
    width: 0.48rem;
    height: 0.26rem;
    border: solid #fff;
    border-width: 0 0 2px 2px;
    transform: translateY(-1px) rotate(-45deg) scale(0);
    transition: transform 0.12s ease-out;
  }
  .approx-row input:checked { background: var(--c); border-color: var(--c); }
  .approx-row input:checked::after { transform: translateY(-1px) rotate(-45deg) scale(1); }
  .approx-row input:hover:not(:disabled) { border-color: var(--c); }
  .approx-row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .approx-row input:disabled { cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) { .approx-row input, .approx-row input::after { transition: none; } }

  /* The main filter: like the selected approximation tile above */
  .main-row {
    cursor: default;
    background: color-mix(in srgb, var(--c) 16%, var(--bg));
    border-color: var(--c);
    box-shadow: inset 0 0 0 1px var(--c);
    color: var(--text);
    font-weight: 600;
  }
  .main-chip {
    justify-self: center;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--c);
    border-radius: 3px;
    padding: 0.05rem 0.3rem;
  }

  .approx-row.off { cursor: not-allowed; opacity: 0.35; }

  .swatch {
    width: 9px; height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    justify-self: center;
  }

  .aname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Order N and the design's highest pole Q */
  .order {
    grid-column: 5;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .n {
    min-width: 1.6rem;
    text-align: right;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .n i {
    font-style: normal;
    font-size: 0.62rem;
    font-weight: 600;
    opacity: 0.6;
    margin-right: 0.12rem;
  }
  .n.q { min-width: 2.6rem; }
  .order.main .n { font-size: 0.95rem; font-weight: 700; color: var(--c); }

  .max-tag {
    grid-column: 4;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--warning);
    background: var(--warning-bg);
    border: 1px solid var(--warning);
    border-radius: 3px;
    padding: 0.02rem 0.3rem;
  }
</style>
