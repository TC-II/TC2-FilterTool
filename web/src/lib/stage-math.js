// Stage (≤ 2nd order section) maths. Roots are [re, im] in rad/s.

export const Q_MIN = 0.5
export const Q_MAX = 50

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mag = ([re, im]) => Math.hypot(re, im)
const isReal = ([re, im]) => Math.abs(im) <= 1e-9 * Math.max(1, Math.hypot(re, im))

/**
 * Natural frequency ω0 (rad/s) and Q of a stage's poles.
 * Complex pair: ω0 = |p|, Q = |p| / (2|Re p|). Two real poles: ω0 = √(p1 p2),
 * Q = ω0 / |p1 + p2|. One pole: ω0 = |p|, Q = null.
 */
export function poleSummary(poles) {
  if (!poles?.length) return { w0: null, q: null }
  if (poles.length === 1) return { w0: mag(poles[0]), q: null }
  const [a, b] = poles
  if (!isReal(a)) {
    const w0 = mag(a)
    return { w0, q: Math.abs(a[0]) > 0 ? w0 / (2 * Math.abs(a[0])) : Infinity }
  }
  const w0 = Math.sqrt(Math.abs(a[0] * b[0]))
  const s = Math.abs(a[0] + b[0])
  return { w0, q: s > 0 ? w0 / s : Infinity }
}

/** Multiply every root by r (frequency scaling; shape and Q preserved). */
export const scaleRoots = (roots, r) => roots.map(([re, im]) => [re * r, im * r])

/**
 * Poles with a new Q at the same ω0 (2-pole stages only). Q = 0.5 gives a double
 * real pole; Q is clamped to [Q_MIN, Q_MAX].
 */
export function withQ(poles, q) {
  if (poles.length !== 2) return poles
  const { w0 } = poleSummary(poles)
  if (!(w0 > 0)) return poles
  q = clamp(q, Q_MIN, Q_MAX)
  const re = -w0 / (2 * q)
  const im = w0 * Math.sqrt(Math.max(0, 1 - 1 / (4 * q * q)))
  return [[re, im], [re, -im]]
}

/**
 * Move root `index` of a 1- or 2-root list to `to` = [re, im].
 * - one root: stays on the real axis
 * - |im| ≤ snapIm: lands on the real axis; a conjugate partner collapses onto
 *   it (double real root), a real partner stays where it is
 * - otherwise the pair becomes (re ± j·im)
 * lhp: poles are kept in the left half plane (re ≤ −minRe).
 * Q of a resulting complex pair is capped at Q_MAX.
 */
export function moveRoot(roots, index, [re, im], { snapIm = 0, lhp = false, minRe = 0 } = {}) {
  if (lhp) re = Math.min(re, -minRe)
  if (roots.length === 1) return [[re, 0]]
  const other = roots[1 - index]
  const out = roots.slice()
  if (Math.abs(im) <= snapIm) {
    out[index] = [re, 0]
    out[1 - index] = isReal(other) ? other : [re, 0]
    return out
  }
  if (lhp) {
    // Q cap: Q = |p| / (2|re|) ≤ Q_MAX  ⇔  |re| ≥ |im| / √(4·Q_MAX² − 1)
    re = Math.min(re, -Math.abs(im) / Math.sqrt(4 * Q_MAX * Q_MAX - 1))
  }
  const up = Math.abs(im)
  out[index] = [re, im >= 0 ? up : -up]
  out[1 - index] = [re, im >= 0 ? -up : up]
  return out
}

/** Canonical normalization for 'Passband' by filter type (as the engine resolves it). */
export function resolveNorm(normtype, filterType) {
  if (normtype !== 'Passband') return normtype
  return filterType === 1 ? 'ω→∞' : filterType === 2 ? 'ω→ω0' : 'ω→0'
}

const NORM_TEXT = {
  'ω→0':  'unity at DC (ω→0)',
  'ω→∞':  'unity at HF (ω→∞)',
  'ω→ω0': 'unity at |p| (ω→ω0)',
}

export const NORM_OPTIONS = ['Passband', 'ω→0', 'ω→∞', 'ω→ω0']

/**
 * Normalizations that work for these roots (normProblem), plus `keep` (the
 * current choice) so a select never shows blank. 'Passband' first when valid.
 */
export function normOptions(filterType, zeros, poles, keep = null) {
  return NORM_OPTIONS.filter(n => n === keep || !normProblem(n, filterType, zeros, poles))
}

/**
 * ω (rad/s) where a design's passband gain is read: 0 for LP / BR, Infinity
 * for HP, the band centre √(ωp1·ωp2) for BP. null without a usable band.
 */
export function passbandRefOmega(params) {
  if (!params) return null
  const n = resolveNorm('Passband', params.filter_type)
  if (n === 'ω→0') return 0
  if (n === 'ω→∞') return Infinity
  const wp = params.wp
  return Array.isArray(wp) ? Math.sqrt(wp[0] * wp[1]) : null
}

/** Descriptive label for a normalization choice. */
export function normLabel(normtype, filterType) {
  if (normtype === 'Passband') return `Auto: ${NORM_TEXT[resolveNorm(normtype, filterType)]}`
  return NORM_TEXT[normtype] ? NORM_TEXT[normtype][0].toUpperCase() + NORM_TEXT[normtype].slice(1) : normtype
}

/**
 * Why a normalization can't work for these roots ('' if it can): unity at DC
 * needs no zero at s = 0, unity at HF needs as many zeros as poles.
 */
export function normProblem(normtype, filterType, zeros, poles) {
  const n = resolveNorm(normtype, filterType)
  if (n === 'ω→0' && zeros.some(z => mag(z) < 1e-9 * Math.max(1, ...poles.map(mag)))) return 'zero at DC'
  if (n === 'ω→∞' && zeros.length < poles.length) return 'fewer zeros than poles'
  return ''
}

/** ω (rad/s) where the stage is normalized to unity: 0, Infinity or |p0|. */
export function normOmega(stage, filterType) {
  const n = resolveNorm(stage.normtype ?? 'Passband', filterType)
  if (n === 'ω→0') return 0
  if (n === 'ω→∞') return Infinity
  return stage.poles?.length ? mag(stage.poles[0]) : null
}
