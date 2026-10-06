<script>
  // Text that keeps the width of its widest variant, so switching language (or
  // a two-state label like Light / Dark) never shifts the controls around it.
  // All variants are stacked in one grid cell; only `text` is visible.

  /** The visible text. */
  export let text = ''
  /** Every text this slot can show (all languages / states). */
  export let variants = []
  /** Alignment of the shorter variants inside the reserved width. */
  export let align = 'center'

  $: ghosts = [...new Set(variants.filter(v => v && v !== text))]
</script>

<span class="stable" style:justify-items={align}><span class="cur">{text}</span>{#each ghosts as g}<span class="ghost" aria-hidden="true">{g}</span>{/each}</span>

<style>
  .stable { display: inline-grid; }
  .stable > span { grid-area: 1 / 1; white-space: nowrap; }
  .ghost { visibility: hidden; }
</style>
