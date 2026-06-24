export const APPROX_NAMES = [
  'Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer',
  'Legendre', 'Bessel', 'Gauss',
]

export const APPROX_COLORS = [
  '#1f77b4',  // 0 Butterworth  (matplotlib tab blue)
  '#d62728',  // 1 Chebyshev I  (matplotlib tab red)
  '#2ca02c',  // 2 Chebyshev II (matplotlib tab green)
  '#ff7f0e',  // 3 Cauer        (matplotlib tab orange)
  '#9467bd',  // 4 Legendre     (matplotlib tab violet)
  '#e377c2',  // 5 Bessel       (matplotlib tab pink)
  '#8c564b',  // 6 Gauss        (matplotlib tab brown)
]

/** Derive a ±2-decade freq range (Hz) from filter params (which use rad/s). */
export function freqRangeFromParams(params) {
  if (!params) return { min: 0.1, max: 1e5 }
  const TWO_PI = 2 * Math.PI
  const wp = params.wp
  let ref
  if (Array.isArray(wp) && wp.length >= 2 && wp[0] > 0) {
    ref = Math.sqrt(wp[0] * wp[1]) / TWO_PI
  } else if (typeof wp === 'number' && wp > 0) {
    ref = wp / TWO_PI
  } else if (params.wrg > 0) {
    ref = params.wrg / TWO_PI
  } else {
    return { min: 0.1, max: 1e5 }
  }
  return { min: Math.max(0.1, ref * 0.01), max: ref * 100 }
}
