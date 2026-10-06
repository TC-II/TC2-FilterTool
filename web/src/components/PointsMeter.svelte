<script>
  // Bode resolution as a signal-strength meter: one bar per preset (2k … 100k),
  // taller = denser. Click a bar (or use the arrow keys) to pick it; the value
  // sits next to it in a fixed-width slot, so nothing moves around it.
  import { createEventDispatcher } from 'svelte'
  import { bodePoints, lang } from '../stores/app.js'
  import { table } from '../lib/i18n.js'

  export let options = [2000, 5000, 10000, 20000, 50000, 100000]
  export let disabled = false
  /** Amber hint: the current design wants more points. */
  export let warn = false

  const dispatch = createEventDispatcher()

  const TX = {
    en: {
      label: 'Bode points',
      title: 'Frequency points used for Bode plots: {n}',
      warn: 'High-order Chebyshev/Cauer: increase the points for accurate Bode plots ({n} now)',
    },
    es: {
      label: 'Puntos de Bode',
      title: 'Puntos de frecuencia usados en los diagramas de Bode: {n}',
      warn: 'Chebyshev/Cauer de orden alto: aumente los puntos para que los diagramas de Bode sean precisos (ahora {n})',
    },
  }
  $: tx = table(TX, $lang)

  const short = n => (n >= 1000 ? `${n / 1000}k` : String(n))
  const full = n => n.toLocaleString($lang === 'es' ? 'es-AR' : 'en-US')

  $: idx = Math.max(0, options.indexOf(Number($bodePoints)))
  let hover = -1

  function pick(i) {
    if (disabled) return
    i = Math.max(0, Math.min(options.length - 1, i))
    if (options[i] === Number($bodePoints)) return
    bodePoints.set(options[i])
    dispatch('change', options[i])
  }

  function onKey(e) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    if (step) { e.preventDefault(); pick(idx + step) }
    else if (e.key === 'Home') { e.preventDefault(); pick(0) }
    else if (e.key === 'End') { e.preventDefault(); pick(options.length - 1) }
  }

  $: title = (warn ? tx.warn : tx.title).replace('{n}', full(options[idx]))
  /** Longest label, to reserve its width ("100k"). */
  $: widest = options.map(short).reduce((a, b) => (b.length > a.length ? b : a), '')
</script>

<div
  class="pm"
  class:warn
  class:disabled
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={tx.label}
  aria-valuemin={options[0]}
  aria-valuemax={options[options.length - 1]}
  aria-valuenow={options[idx]}
  aria-valuetext={full(options[idx])}
  aria-disabled={disabled}
  {title}
  on:keydown={onKey}
  on:mouseleave={() => (hover = -1)}
>
  <span class="bars" aria-hidden="true">
    {#each options as n, i}
      <button
        type="button"
        tabindex="-1"
        aria-label={full(n)}
        class="bar"
        class:on={i <= idx}
        class:preview={hover >= 0 && i <= hover && i > idx}
        class:drop={hover >= 0 && i > hover && i <= idx}
        class:next={i === idx + 1}
        style:--h="{30 + (70 * i) / (options.length - 1)}%"
        {disabled}
        on:mouseenter={() => (hover = i)}
        on:click={() => pick(i)}
      ><span></span></button>
    {/each}
  </span>
  <span class="val" aria-hidden="true">
    <span class="cur">{short(options[hover >= 0 ? hover : idx])}</span><span class="ghost">{widest}</span>
  </span>
</div>

<style>
  .pm {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    height: 1.75rem;
    padding: 0 0.45rem 0 0.3rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    outline: none;
  }
  .pm:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .pm.disabled { opacity: 0.45; pointer-events: none; }

  .bars {
    display: flex;
    align-items: flex-end;
    height: 1.05rem;
  }
  .bar {
    display: flex;
    align-items: flex-end;
    height: 100%;
    width: 0.55rem;
    padding: 0 1px;
    border: none;
    background: none;
    cursor: pointer;
  }
  .bar > span {
    display: block;
    width: 100%;
    height: var(--h);
    border-radius: 1px;
    background: var(--border);
    transition: background 0.12s, opacity 0.12s;
  }
  .bar.on > span { background: var(--accent); }
  .bar.preview > span { background: var(--accent); opacity: 0.4; }
  .bar.drop > span { opacity: 0.35; }

  .val {
    display: inline-grid;
    justify-items: end;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .val > span { grid-area: 1 / 1; }
  .ghost { visibility: hidden; }

  /* The design wants more points: amber meter, the next bar up hints where to go */
  .pm.warn { border-color: var(--warning); background: var(--warning-bg); }
  .pm.warn .bar.on > span { background: var(--warning); }
  .pm.warn .val { color: var(--warning); font-weight: 600; }
  .pm.warn .bar.next:not(.preview) > span { background: var(--warning); animation: nudge 1.4s ease-in-out infinite; }
  @keyframes nudge { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.6; } }

  @media (prefers-reduced-motion: reduce) { .bar > span { transition: none; animation: none !important; } }
</style>
