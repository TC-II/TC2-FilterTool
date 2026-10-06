<script>
  // Approximation picker: one tile per approximation with a mini |H| sketch
  // (lib/approx-sketches.js) in its plot colour.
  import { createEventDispatcher } from 'svelte'
  import { APPROX_NAMES, plotColor } from '../../lib/approx.js'
  import { loadSketches, sketchY, SKETCH_W, SKETCH_H } from '../../lib/approx-sketches.js'
  import { getWorkerApi } from '../../lib/worker-client.js'
  import { engineReady, theme, colorMode, colorShuffle, lang } from '../../stores/app.js'
  import { table, approxName } from '../../lib/i18n.js'

  export let value = 0
  /** Approximation indices that can be picked (others are shown disabled). */
  export let allowed = null
  /** Tooltip for disabled tiles (default: tx.na). */
  export let disabledTitle = ''

  const TX = {
    en: {
      aria: 'Approximation',
      na: 'Not available for this filter type',
      ghost: ' (grey: Butterworth, same spec)',
      short: ['Butter', 'Cheby I', 'Cheby II', 'Cauer', 'Optimum L', 'Bessel', 'Gauss'],
      trait: [
        'Maximally flat passband',
        'Equiripple passband, steep',
        'Flat passband, equiripple stopband',
        'Ripple in both bands, steepest',
        'Monotonic, steeper than Butterworth',
        'Near-linear phase, gentle roll-off',
        'No overshoot, gentle roll-off',
      ],
    },
    es: {
      aria: 'Aproximación',
      na: 'No disponible para este tipo de filtro',
      ghost: ' (gris: Butterworth, misma plantilla)',
      short: ['Butter', 'Cheby I', 'Cheby II', 'Cauer', 'Óptimo L', 'Bessel', 'Gauss'],
      trait: [
        'Banda de paso máximamente plana',
        'Banda de paso equiripple, pendiente pronunciada',
        'Banda de paso plana, banda de atenuación equiripple',
        'Oscilaciones en ambas bandas, la transición más abrupta',
        'Monótona, más abrupta que Butterworth',
        'Fase casi lineal, caída suave',
        'Sin sobrepico, caída suave',
      ],
    },
  }
  $: tx = table(TX, $lang)

  const dispatch = createEventDispatcher()
  let sketches = Array(7).fill(null)   // { path, ghost, gp, ga } per approximation

  $: if ($engineReady) loadSketches(getWorkerApi()).then(s => (sketches = s))

  // Reactive so the template re-evaluates when `allowed` changes.
  $: can = i => !allowed || allowed.has(i)

  function pick(i) {
    if (!can(i) || i === value) return
    value = i
    dispatch('change', i)
  }

  // Arrow keys move through the enabled tiles (grid is 4 wide).
  function onKeydown(e) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key]
    if (!step) return
    e.preventDefault()
    let i = value
    for (let n = 0; n < 7; n++) {
      i = (i + step + 7) % 7
      if (can(i)) break
    }
    pick(i)
    e.currentTarget.querySelector(`[data-i="${i}"]`)?.focus()
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tiles" role="radiogroup" aria-label={tx.aria} on:keydown={onKeydown}>
  {#each APPROX_NAMES as _, i}
    {@const name = approxName(i, $lang)}
    {@const color = plotColor(i, $theme, $colorMode, $colorShuffle)}
    <button
      type="button"
      role="radio"
      data-i={i}
      class="tile"
      class:on={value === i}
      aria-checked={value === i}
      aria-label={name}
      tabindex={value === i ? 0 : -1}
      disabled={!can(i)}
      title={can(i) ? `${name}: ${tx.trait[i]}${i ? tx.ghost : ''}` : `${name}: ${disabledTitle || tx.na}`}
      style="--c: {color}"
      on:click={() => pick(i)}
    >
      <svg viewBox="0 0 {SKETCH_W} {SKETCH_H}" preserveAspectRatio="none" aria-hidden="true">
        <line class="axis" x1="0" y1={SKETCH_H - 1} x2={SKETCH_W} y2={SKETCH_H - 1} />
        {#if sketches[i]}
          {@const sk = sketches[i]}
          <line class="guide" x1="0" y1={sketchY(sk.gp)} x2={SKETCH_W} y2={sketchY(sk.gp)} />
          <line class="guide" x1="0" y1={sketchY(sk.ga)} x2={SKETCH_W} y2={sketchY(sk.ga)} />
          {#if sk.ghost}<path class="ghost" d={sk.ghost} />{/if}
          {#if sk.path}<path class="curve" d={sk.path} />{/if}
        {/if}
      </svg>
      <span class="name" class:long={tx.short[i].length > 8}>{tx.short[i]}</span>
    </button>
  {/each}
</div>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.3rem;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.15rem;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    padding: 0.3rem 0.3rem 0.22rem;
    transition: border-color 0.12s, background 0.12s;
  }
  .tile:hover:not(:disabled):not(.on) {
    background: var(--surface-2);
    border-color: color-mix(in srgb, var(--c) 55%, var(--border));
  }
  .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tile.on {
    background: color-mix(in srgb, var(--c) 14%, var(--bg));
    border-color: var(--c);
    box-shadow: inset 0 0 0 1px var(--c);
    color: var(--text);
  }
  .tile:disabled { opacity: 0.3; cursor: not-allowed; }

  svg {
    display: block;
    width: 100%;
    height: 1.6rem;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .curve { stroke: var(--c); stroke-width: 1.6; }
  /* Butterworth reference of the same spec */
  .ghost { stroke: var(--text-dim); stroke-width: 1.1; opacity: 0.45; }
  .axis, .guide {
    stroke: var(--border);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .guide { stroke-dasharray: 2 2; opacity: 0.8; }

  .name {
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    white-space: nowrap;
    /* Clip sideways only, so accents (Óptimo L) aren't cut at the top */
    overflow: clip visible;
    text-overflow: ellipsis;
  }
  .tile.on .name { font-weight: 700; }
  /* "Optimum L" in a quarter-width tile */
  .name.long { font-size: 0.62rem; letter-spacing: -0.03em; }
</style>
