// One colour per stage, shared by the Stages plot, stage cards and PZ maps.
//
// Stage hues sit in the gaps between the approximation colours (lib/approx.js:
// blue, red, green, orange, purple, pink, brown): cyan, yellow, magenta, lime,
// indigo, teal… and any hue close to the main filter's colour is skipped, so a
// staged pole never looks like an unassigned one.

/** Stage hues (degrees), in the order new stages take them. */
const HUES = [182, 52, 300, 92, 240, 160, 72, 200]
const AVOID_DEG = 38

const hsl = (h, theme) => (theme === 'light' ? `hsl(${h}, 80%, 34%)` : `hsl(${h}, 75%, 62%)`)

/** Hue (degrees) of a #rrggbb colour, or null for greys / anything else. */
function hueOf(color) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? '')
  if (!m) return null
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d < 0.08) return null                       // grey: nothing to avoid
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) }

/** Stage palette for a main filter colour (hues near it removed). */
function paletteFor(avoid) {
  const h0 = hueOf(avoid)
  return h0 == null ? HUES : HUES.filter(h => hueDist(h, h0) >= AVOID_DEG)
}

/**
 * @param {number} index stage colour index
 * @param {'light'|'dark'} theme
 * @param {string} [avoid] main filter colour (#rrggbb) the stages must not look like
 */
export function stageColor(index, theme = 'dark', avoid = null) {
  const p = paletteFor(avoid)
  return hsl(p[((index % p.length) + p.length) % p.length], theme)
}

/** A stage keeps its colour when stages are reordered or removed. */
export const colorOf = (stage, fallbackIndex, theme, avoid = null) =>
  stageColor(stage.colorIndex ?? fallbackIndex, theme, avoid)

/** Colour index for a new stage: one past the highest in use. */
export const nextColorIndex = list => list.reduce((m, s, i) => Math.max(m, (s.colorIndex ?? i) + 1), 0)
