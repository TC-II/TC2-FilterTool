export const APPROX_NAMES = [
  'Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer',
  'Legendre', 'Bessel', 'Gauss',
]

/** Matplotlib tab10 — readable on light plots. */
export const APPROX_COLORS = [
  '#1f77b4',  // 0 Butterworth
  '#d62728',  // 1 Chebyshev I
  '#2ca02c',  // 2 Chebyshev II
  '#ff7f0e',  // 3 Cauer
  '#9467bd',  // 4 Legendre
  '#e377c2',  // 5 Bessel
  '#8c564b',  // 6 Gauss
]

/** Brighter counterparts for dark plot backgrounds. */
export const APPROX_COLORS_DARK = [
  '#58a6ff',  // 0 Butterworth
  '#ff7b72',  // 1 Chebyshev I
  '#3fb950',  // 2 Chebyshev II
  '#ffa657',  // 3 Cauer
  '#d2a8ff',  // 4 Legendre
  '#f778ba',  // 5 Bessel
  '#d4a574',  // 6 Gauss
]

export function approxColor(index, theme = 'dark') {
  const palette = theme === 'light' ? APPROX_COLORS : APPROX_COLORS_DARK
  return palette[index] ?? palette[0]
}

export const COLOR_MODES = ['default', 'gray', 'random']

export function grayColor(theme = 'dark') {
  return theme === 'light' ? '#57606a' : '#8b949e'
}

/** Fisher–Yates shuffle of palette indices 0..n-1. */
export function shufflePalette(n = APPROX_COLORS.length) {
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

/**
 * Color for any approx trace (main or comparison).
 * mode: 'default' | 'gray' | 'random'
 * shuffle: palette index remap used when mode === 'random'
 */
export function plotColor(approxType, theme, mode = 'default', shuffle = null) {
  if (mode === 'gray') return grayColor(theme)
  if (mode === 'random' && Array.isArray(shuffle) && shuffle.length) {
    return approxColor(shuffle[approxType] ?? approxType, theme)
  }
  return approxColor(approxType, theme)
}

/** Line style for comparison traces. */
export function compareLine(approxType, theme, { dash = true, mode = 'default', shuffle = null } = {}) {
  return {
    color: plotColor(approxType, theme, mode, shuffle),
    width: 1.5,
    ...(dash ? { dash: 'dash' } : {}),
  }
}

/** Derive a freq range (Hz) from filter params (which use rad/s). */
export function freqRangeFromParams(params) {
  if (!params) return { min: 0.1, max: 1e5 }
  const TWO_PI = 2 * Math.PI
  const wp = params.wp
  let ref
  let band = false
  if (Array.isArray(wp) && wp.length >= 2 && wp[0] > 0) {
    ref = Math.sqrt(wp[0] * wp[1]) / TWO_PI
    band = true
  } else if (typeof wp === 'number' && wp > 0) {
    ref = wp / TWO_PI
  } else if (params.wrg > 0) {
    ref = params.wrg / TWO_PI
  } else {
    return { min: 0.1, max: 1e5 }
  }
  // Band filters use a tighter window; LP/HP/GD span ±2 decades.
  if (band) return { min: Math.max(0.1, ref * 0.05), max: ref * 20 }
  return { min: Math.max(0.1, ref * 0.01), max: ref * 100 }
}
