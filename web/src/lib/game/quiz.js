// Game mode: random filter rounds and the questions asked about them.
// Pure logic (no Svelte, no worker), so it runs under node too.
//
// A round is one random design (approximation × filter type × order) shown
// through one "view" (magnitude, phase, pole-zero map, step response…), with
// one of these round kinds:
//   choice — CHOICE_QUESTIONS multiple-choice questions that view can answer
//   match  — pick, among 4 plots of another view, the one of the same filter
//   lineup — 3–4 approximations of one template, overlaid: name each curve
//   theory — a flash card, no plot (see theory.js)

import { LP, HP, BP, BR, F0_BW, DEFAULT_FORM, buildParams } from '../params.js'
import { computeStep, zpkGainFromBa, responseDuration } from '../time-response.js'
import { makeTheoryQuestion } from './theory.js'

export const GAME_APPROX = [0, 1, 2, 3, 4]
export const APPROX_LABELS = ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Legendre']
export const GAME_TYPES = [LP, HP, BP, BR]
export const TYPE_LABELS = ['Low-pass', 'High-pass', 'Band-pass', 'Band-reject']
export const TYPE_SHORT = ['LP', 'HP', 'BP', 'BR']

export const QUESTION_KINDS = ['approx', 'type', 'order', 'protoOrder', 'ripple', 'stepStart', 'stepEnd']
/** Kinds that only apply to some filter types (BP / BR). */
const BAND_ONLY = new Set(['protoOrder'])

/** What each view shows and which questions it can answer. */
export const VIEWS = [
  { id: 'magnitude',  label: 'Magnitude',  title: 'Magnitude |H(jω)|',  questions: ['approx', 'type', 'order', 'protoOrder', 'ripple', 'stepStart', 'stepEnd'] },
  { id: 'phase',      label: 'Phase',      title: 'Phase ∠H(jω)',        questions: ['approx', 'type', 'order', 'protoOrder'] },
  { id: 'poleZero',   label: 'Pole-zero',  title: 'Pole-zero map',       questions: ['approx', 'type', 'order', 'protoOrder', 'ripple'] },
  { id: 'step',       label: 'Step',       title: 'Step response y(t)',  questions: ['type', 'approx'] },
  { id: 'groupDelay', label: 'Group delay', title: 'Group delay τ(ω)',   questions: ['approx', 'type'] },
]
export const viewById = id => VIEWS.find(v => v.id === id)

export const ROUND_KINDS = [
  { id: 'choice', label: 'Multiple choice' },
  { id: 'match',  label: 'Match the plot' },
  { id: 'lineup', label: 'Line-up' },
  { id: 'theory', label: 'Theory cards' },
]

/**
 * Bumped when round kinds are added, so saves from before get the new kinds
 * switched on once (otherwise an old save would hide them).
 */
export const SETTINGS_VERSION = 2
const KINDS_SINCE = { lineup: 2, theory: 2 }

/** Questions per multiple-choice round (fixed for now). */
export const CHOICE_QUESTIONS = 2

/**
 * Match rounds: given one view, which views the 4 cards may show. Magnitude /
 * phase / pole-zero pair freely; the step response only pairs with magnitude
 * or pole-zero (where H(0), H(∞) and the ringing can be read off); the group
 * delay can be a card next to magnitude, phase or pole-zero. The same filter
 * never appears twice in one view, so the number of correct cards is capped
 * by how many views the given one allows (4 for magnitude / pole-zero).
 */
export const MATCH_TARGETS = {
  magnitude: ['phase', 'poleZero', 'step', 'groupDelay'],
  poleZero:  ['magnitude', 'phase', 'step', 'groupDelay'],
  phase:     ['magnitude', 'poleZero', 'groupDelay'],
  step:      ['magnitude', 'poleZero'],
}

const MATCH_NOUN = {
  magnitude: 'magnitude', phase: 'phase', poleZero: 'pole-zero map',
  step: 'step response', groupDelay: 'group delay',
}

export const DEFAULT_SETTINGS = {
  v: SETTINGS_VERSION,
  kinds: ROUND_KINDS.map(k => k.id),
  views: VIEWS.map(v => v.id),
  types: [...GAME_TYPES],
  approxes: [...GAME_APPROX],
}

/** Drop unknown / stale entries from saved settings (keeps at least one of each). */
export function sanitizeSettings(saved) {
  const keep = (list, allowed, fallback) => {
    const v = Array.isArray(list) ? list.filter(x => allowed.includes(x)) : []
    return v.length ? v : [...fallback]
  }
  let kinds = keep(saved?.kinds, ROUND_KINDS.map(k => k.id), DEFAULT_SETTINGS.kinds)
  const from = Number(saved?.v) || 1
  if (from < SETTINGS_VERSION) {
    for (const [k, since] of Object.entries(KINDS_SINCE)) if (since > from && !kinds.includes(k)) kinds.push(k)
    kinds = ROUND_KINDS.map(k => k.id).filter(k => kinds.includes(k))
  }
  return {
    v: SETTINGS_VERSION,
    kinds,
    views: keep(saved?.views, VIEWS.map(v => v.id), DEFAULT_SETTINGS.views),
    types: keep(saved?.types, GAME_TYPES, DEFAULT_SETTINGS.types),
    approxes: keep(saved?.approxes, GAME_APPROX, DEFAULT_SETTINGS.approxes),
  }
}

// ── Random helpers ───────────────────────────────────────────────────────────

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]
const randInt = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1))
function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Round specs ──────────────────────────────────────────────────────────────

const isBandType = ft => ft === BP || ft === BR

/**
 * Prototype order range per approximation and type. Legendre starts at 3: its
 * 2nd-order polynomial is the Butterworth biquad, so the two can't be told apart.
 */
export function orderBounds(approx, ft) {
  return [approx === 4 ? 3 : 2, isBandType(ft) ? 4 : 6]
}

/** Approximations whose order parity shows (H(0) / H(∞) of an even order sit on the ripple). */
const PARITY_VISIBLE = new Set([1, 2, 3])
/** Approximations with an equiripple stopband (their −Aa level shows in the plots). */
const STOP_RIPPLE = new Set([2, 3])

/**
 * Template "shape" shared by every filter of a round: ripple, attenuation,
 * selectivity, width. Always Ap ≥ 3 dB and Aa ≤ 40 dB; `clear` (the default)
 * caps Aa at 30 dB for rounds where the stopband level matters (its ripple,
 * the −Aa floor, the step's y(0⁺) / y(∞) offsets), so it is plainly visible.
 */
const AA_CLEAR = [20, 25, 30]
const AA_ANY = [30, 35, 40]
function randomShape(rng, clear = true) {
  return {
    apDb: pick([3, 4, 5], rng),
    aaDb: pick(clear ? AA_CLEAR : AA_ANY, rng),
    k: pick([1.6, 2, 2.5], rng),
    bw: pick([0.4, 0.5, 0.6], rng),
  }
}

/**
 * Normalized design (ωp = 1 rad/s for LP/HP, ω0 = 1 rad/s for BP/BR) with a
 * fixed order (N_min = N_max).
 */
export function makeSpec(approx, ft, n, shape) {
  const { apDb, aaDb, k, bw } = shape
  const form = {
    ...DEFAULT_FORM,
    filterType: ft, approxType: approx,
    nMin: n, nMax: n, apDb, aaDb, gainDb: 0, denorm: 0,
    defineWith: F0_BW, f0: 1,
  }
  if (ft === LP) { form.fp = 1; form.fa = k }
  if (ft === HP) { form.fp = 1; form.fa = 1 / k }
  if (ft === BP) { form.bwp = bw; form.bwa = bw * k }
  if (ft === BR) { form.bwa = bw * 0.75; form.bwp = bw * 0.75 * k }
  return { approx, ft, n, apDb, aaDb, shape, form, params: buildParams(form, 1) }
}

/** A random design within the enabled types / approximations. */
export function randomSpec(settings = DEFAULT_SETTINGS, rng = Math.random, clear = true) {
  const approx = pick(settings.approxes?.length ? settings.approxes : GAME_APPROX, rng)
  const ft = pick(settings.types?.length ? settings.types : GAME_TYPES, rng)
  const [lo, hi] = orderBounds(approx, ft)
  return makeSpec(approx, ft, randInt(lo, hi, rng), randomShape(rng, clear))
}

/**
 * Three wrong options for a match round. At least one shares the real filter's
 * type (so ≥ 2 of the 4 plots have the right type), and the prototype order
 * stays within ±1 of the real one — ±2 for Chebyshev / Cauer distractors,
 * whose parity is visible, so an order of the wrong parity can't give it away.
 */
export function distractorSpecs(real, settings = DEFAULT_SETTINGS, rng = Math.random, allApprox = GAME_APPROX) {
  /** Every valid (type, approx, order) near the real filter, from the given pools. */
  const candidates = (types, approxes) => {
    const out = []
    for (const ft of types) {
      for (const approx of approxes) {
        const step = PARITY_VISIBLE.has(approx) ? 2 : 1
        const [lo, hi] = orderBounds(approx, ft)
        for (const n of [real.n - step, real.n, real.n + step]) {
          if (n < lo || n > hi + 1) continue
          if (ft === real.ft && approx === real.approx && n === real.n) continue
          out.push({ ft, approx, n })
        }
      }
    }
    return out
  }
  const attempt = (types, approxes) => {
    const all = candidates(types, approxes)
    const same = shuffle(all.filter(c => c.ft === real.ft), rng)
    const other = shuffle(all.filter(c => c.ft !== real.ft), rng)
    if (!same.length || same.length + other.length < 3) return null
    const nSame = Math.min(same.length, other.length ? randInt(1, 3, rng) : 3)
    const picked = [...same.slice(0, nSame), ...other.slice(0, 3 - nSame)]
    // Not enough of the other types: top up with more same-type ones
    for (const c of same.slice(nSame)) if (picked.length < 3) picked.push(c)
    return picked.length === 3 ? picked.map(c => makeSpec(c.approx, c.ft, c.n, real.shape)) : null
  }
  const types = settings.types?.length ? settings.types : GAME_TYPES
  const approxes = settings.approxes?.length ? settings.approxes : GAME_APPROX
  // Only when the enabled filters can't give 3 distinct options, widen to everything
  return attempt(types, approxes) ?? attempt(types, allApprox) ?? attempt(GAME_TYPES, allApprox)
}

/** Drop leading coefficients that are numerically zero. */
function trimLeading(c) {
  const max = Math.max(...c.map(Math.abs), 0)
  let i = 0
  while (i < c.length - 1 && Math.abs(c[i]) <= 1e-12 * max) i++
  return c.slice(i)
}

/** Bode range in Hz around the normalized reference (1 rad/s). */
export function freqRangeHz(ft) {
  const ref = 1 / (2 * Math.PI)
  return ft === BP || ft === BR ? { min: ref / 10, max: ref * 10 } : { min: ref / 100, max: ref * 100 }
}

/**
 * Design `spec` with the engine and compute everything the views need.
 * @param {import('../engine-api').EngineApi} api
 */
export async function buildDesign(api, spec, points = 2000, range = freqRangeHz(spec.ft)) {
  const r = await api.filterDesign(spec.params)
  if (r.error) throw new Error(r.error)
  const { min, max } = range
  const bode = await api.computeBode(r.num, r.den, min, max, points)
  const num = trimLeading(r.num), den = trimLeading(r.den)
  const k = zpkGainFromBa(r.num, r.den)
  const tEnd = responseDuration(r.poles)
  const step = k == null ? null : computeStep(r.zeros, r.poles, k, 1500, tEnd)
  const h0 = num[num.length - 1] / den[den.length - 1]
  const hInf = num.length === den.length ? num[0] / den[0] : 0
  return {
    zeros: r.zeros, poles: r.poles, num: r.num, den: r.den, N: r.N,
    bode, step,
    h0: Number.isFinite(h0) ? h0 : 0,
    hInf: Number.isFinite(hInf) ? hInf : 0,
  }
}

// ── Facts used by answers and explanations ───────────────────────────────────

/** Where |H| ripples, per approximation. */
const RIPPLE_OF = ['none', 'pass', 'stop', 'both', 'none']
const RIPPLE_LABELS = {
  none: 'Nowhere (monotonic)',
  pass: 'Passband only',
  stop: 'Stopband only',
  both: 'Both bands',
}

export const APPROX_FACTS = [
  'Butterworth: maximally flat, monotonic |H|. All-pole, with the poles on a circle.',
  'Chebyshev I: equiripple passband, monotonic stopband. All-pole, with the poles on an ellipse (closer to the jω axis than Butterworth).',
  'Chebyshev II (inverse Chebyshev): flat passband, equiripple stopband. Its zeros on the jω axis put notches in the stopband.',
  'Cauer (elliptic): ripple in both bands plus jω-axis zeros: the sharpest transition for a given order.',
  'Legendre (optimum-L): monotonic like Butterworth, but with the steepest roll-off a monotonic response can have. All-pole.',
]

const APPROX_CUE = {
  magnitude: 'Look for ripple in each band, and for notches (zeros) in the stopband.',
  phase: 'jω-axis zeros (Chebyshev II / Cauer) show up as 180° phase jumps. Rippled approximations bend the phase more sharply near the band edge.',
  poleZero: 'Poles on a circle → Butterworth; on a flatter ellipse → Chebyshev I; zeros on the jω axis → Chebyshev II or Cauer. Legendre poles look Butterworth-like, but pushed closer to the jω axis near the band edge.',
  step: 'Rippled passbands ring the most: Chebyshev I and Cauer overshoot the most (about 25–30 % at even order) and ring the longest. Butterworth, Legendre (a bit more than Butterworth) and Chebyshev II are milder, around 5–17 % depending on the order.',
  groupDelay: 'The delay peaks at the band edge, and the sharper the approximation, the taller the peak: Cauer ≫ Chebyshev I > Legendre ≳ Chebyshev II ≈ Butterworth.',
}

export const TYPE_FACTS = [
  'Low-pass: passes ω → 0, rejects ω → ∞.',
  'High-pass: rejects ω → 0, passes ω → ∞.',
  'Band-pass: passes around ω0 and rejects both ends.',
  'Band-reject: rejects around ω0 and passes both ends.',
]

const TYPE_CUE = {
  magnitude: 'Check where |H| is high: at DC, at high frequency, in the middle, or everywhere except the middle.',
  phase: 'All-pole LP phase falls from 0° to −n·90°. HP starts positive and goes to 0°. BP sweeps from + to −, crossing 0° at ω0. BR comes back to the same phase at both ends.',
  poleZero: 'LP: zeros at ∞ (or on the jω axis above the passband). HP: zeros at the origin (or on jω below the passband). BP: zeros at the origin and at ∞. BR: zeros on the jω axis at ±jω0.',
  step: 'y(0⁺) = H(∞) and y(∞) = H(0). LP rises from 0 to H(0). HP jumps to H(∞) and decays to 0. BP starts and ends at 0 (a ringing burst). BR starts at H(∞), dips, and settles back at H(0).',
  groupDelay: 'The delay peaks where the response transitions: at one edge for LP/HP (LP is flat at DC, HP flat at high ω), at two edges for BP/BR.',
}

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/**
 * How to read the prototype order n off *this* filter's plot: only the cues
 * it actually has (no "count the notches" for an all-pole Chebyshev I).
 * Checked against the engine: LP/HP passband extrema = n (counting the flat
 * end), BP passband peaks = n, BR extrema per passband = n; stopband notches =
 * ⌊n/2⌋ for LP/HP (per side for BP) and n for BR.
 */
function readOrder(spec, viewId) {
  const { n, ft, approx } = spec
  const band = isBandType(ft)
  const allPole = approx === 0 || approx === 1 || approx === 4
  const passRipple = approx === 1 || approx === 3
  const stopZeros = approx === 2 || approx === 3
  const half = Math.floor(n / 2)
  const cues = []

  if (viewId === 'poleZero') {
    cues.push(`count the × marks: ${plural(band ? 2 * n : n, 'pole')}${band ? ', two per prototype pole' : ''}`)
  } else if (viewId === 'phase') {
    if (allPole) {
      if (ft === LP) cues.push(`the phase falls from 0° to −n·90° = −${n * 90}°`)
      if (ft === HP) cues.push(`the phase falls from +n·90° = +${n * 90}° to 0°`)
      if (ft === BP) cues.push(`the phase sweeps from +n·90° to −n·90° (±${n * 90}°), crossing 0° at ω0`)
      if (ft === BR) cues.push(`the phase reaches ∓n·90° (${n * 90}°) on each side of ω0 and jumps n·180° at the notch, where n zero pairs sit on ±jω0`)
    } else {
      const jumps = ft === BR ? n : ft === BP ? 2 * half : half
      cues.push(`every jω-axis zero pair makes a 180° jump: ${plural(jumps, 'jump')}`)
      if (ft === BR) cues.push('one per prototype order')
      else if (ft === BP) cues.push(`${plural(half, 'jump')} on each side, one per pair of prototype zeros`)
      else cues.push(`one per pair of prototype zeros${n % 2 ? `, and the odd order's extra pole leaves a net ${ft === LP ? '−' : '+'}90° at the ${ft === LP ? 'high' : 'low'} end` : ''}`)
    }
  } else {
    // magnitude
    if (passRipple) {
      if (ft === LP || ft === HP) cues.push(`the passband shows n = ${n} peaks and valleys, counting the flat end at ${ft === LP ? 'ω = 0' : 'ω → ∞'}`)
      if (ft === BP) cues.push(`the passband shows n = ${plural(n, 'peak')}`)
      if (ft === BR) cues.push(`each passband shows n = ${n} peaks and valleys, counting its flat end`)
    }
    if (stopZeros) {
      if (ft === LP || ft === HP) {
        cues.push(`the stopband has ${plural(half, 'notch', 'notches')}, each a pair of jω zeros`)
        cues.push(n % 2
          ? `past the last notch |H| keeps ${ft === LP ? 'falling' : 'rising'} at 20 dB/dec (the odd order's extra pole), so n = 2·${half} + 1`
          : `past the last notch |H| levels off at −Aa (as many zeros as poles: even order), so n = 2·${half}`)
      }
      if (ft === BP) cues.push(n % 2
        ? `each stopband has ${plural(half, 'notch', 'notches')} and the skirts keep falling at 20 dB/dec past them (odd order), so n = 2·${half} + 1`
        : `each stopband has ${plural(half, 'notch', 'notches')} and then levels off at −Aa (even order), so n = 2·${half}`)
      if (ft === BR) cues.push(`the stopband has n = ${plural(n, 'notch', 'notches')}`)
    }
    if (allPole && ft !== BR) {
      const where = ft === BP ? 'each skirt falls' : ft === LP ? 'far above the edge |H| falls' : 'far below the edge |H| falls (towards DC)'
      cues.push(`${where} at 20·n dB/dec = ${20 * n} dB/dec`)
    }
    if (allPole && !passRipple && ft === BR) {
      cues.push('there is no ripple or notch count to read: a higher order only makes the notch wider and its sides steeper')
    }
  }
  return cues.join('; ')
}

// ── Questions ────────────────────────────────────────────────────────────────

const fmtVal = v => (v === 0 ? '0' : v === 1 ? '1' : v >= 0.1 ? v.toFixed(3) : v.toPrecision(3))

/** Options for H(0) / H(∞): 0, 1, the passband floor and the stopband level. */
function levelOptions(spec, actual) {
  const cands = [
    { id: 'one',  v: 1,                        label: '1' },
    { id: 'ap',   v: 10 ** (-spec.apDb / 20),  label: `${fmtVal(10 ** (-spec.apDb / 20))} (−${spec.apDb} dB)` },
    { id: 'aa',   v: 10 ** (-spec.aaDb / 20),  label: `${fmtVal(10 ** (-spec.aaDb / 20))} (−${spec.aaDb} dB)` },
    { id: 'zero', v: 0,                        label: '0' },
  ]
  let best = null, bestErr = Infinity
  for (const c of cands) {
    const err = Math.abs(actual - c.v)
    if (err < bestErr) { best = c; bestErr = err }
  }
  const tol = 1e-6 + 0.02 * Math.abs(best.v)
  if (bestErr > tol) {
    best = { id: 'other', v: actual, label: fmtVal(actual) }
    cands.push(best)
  }
  return { options: cands.map(({ id, label }) => ({ id, label })), answer: best.id }
}

/** Which level ('one' / 'ap' / 'aa' / 'zero' / 'other') an H(0) or H(∞) value sits on. */
const levelOf = (spec, v) => levelOptions(spec, v).answer

/** No Legendre in step views: its step can't be told from Butterworth's. */
const STEP_APPROX = GAME_APPROX.filter(a => a !== 4)

/**
 * The approximation can only be read off a step response when a ripple level
 * shows at t = 0⁺ or t → ∞, i.e. even-order Chebyshev / Cauer (and not, say, a
 * Chebyshev I band-pass, whose step starts and ends at 0). Asked as
 * "Butterworth or X?", so Butterworth must be enabled.
 */
function stepApproxAnswerable(spec, design, pools) {
  if (!PARITY_VISIBLE.has(spec.approx) || spec.n % 2 || !pools.approxes.includes(0)) return false
  return [design.h0, design.hInf].some(v => ['ap', 'aa'].includes(levelOf(spec, v)))
}

function levelReason(which, answer, spec) {
  const at = which === 'inf' ? 'ω → ∞' : 'ω → 0'
  const band = which === 'inf' ? 'right' : 'left'
  switch (answer) {
    case 'zero': return which === 'inf'
      ? 'H(s) has more poles than zeros, so |H| → 0 as ω → ∞.'
      : 'H(s) has zeros at the origin (HP / BP), so H(0) = 0.'
    case 'one': return `The filter passes ${at}, where |H| equals the passband peak (gain 1). Read it at the ${band} edge of the magnitude plot.`
    case 'ap': return `The filter passes ${at}, and an even-order Chebyshev I / Cauer sits at the bottom of the passband ripple there: 10^(−Ap/20) = ${fmtVal(10 ** (-spec.apDb / 20))}.`
    case 'aa': return `The filter rejects ${at}, but an even-order Chebyshev II / Cauer has as many finite zeros as poles, so |H| levels off at the stopband ripple: 10^(−Aa/20) = ${fmtVal(10 ** (-spec.aaDb / 20))}.`
    default: return `Here the limit is ${answer}.`
  }
}

function orderOptions(p, rng) {
  const start = Math.max(1, p - randInt(0, 3, rng))
  return [0, 1, 2, 3].map(i => ({ id: String(start + i), label: String(start + i) }))
}

/**
 * Build one question.
 * @returns {{ kind, prompt, options: {id,label}[], answer: string, explain: string }}
 */
/**
 * What the answers may list, from the enabled approximations / types: a
 * filter switched off in Options never shows up as an option.
 */
export function answerPools(settings = DEFAULT_SETTINGS) {
  const approxes = GAME_APPROX.filter(a => !settings.approxes?.length || settings.approxes.includes(a))
  const types = GAME_TYPES.filter(t => !settings.types?.length || settings.types.includes(t))
  const ripples = Object.keys(RIPPLE_LABELS).filter(r => approxes.some(a => RIPPLE_OF[a] === r))
  return { approxes, types, ripples }
}

/** A question whose answer is forced by the settings (a single option) is not worth asking. */
function trivialKind(kind, pools) {
  if (kind === 'approx') return pools.approxes.length < 2
  if (kind === 'type') return pools.types.length < 2
  if (kind === 'ripple') return pools.ripples.length < 2
  return false
}

export function makeQuestion(kind, viewId, spec, design, rng = Math.random, pools = answerPools()) {
  switch (kind) {
    case 'approx': if (viewId === 'step') {
      const lv = v => `${fmtVal(v)}${['ap', 'aa'].includes(levelOf(spec, v)) ? ` (−${levelOf(spec, v) === 'ap' ? spec.apDb : spec.aaDb} dB)` : ''}`
      return {
        kind, prompt: 'Which approximation is it?',
        options: [0, spec.approx].map(a => ({ id: String(a), label: APPROX_LABELS[a] })),
        answer: String(spec.approx),
        explain: `Here y(0⁺) = H(∞) = ${lv(design.hInf)} and y(∞) = H(0) = ${lv(design.h0)}: one of them sits on a ripple level, which only an even-order ${spec.approx === 2 ? 'Chebyshev II / Cauer' : spec.approx === 1 ? 'Chebyshev I / Cauer' : 'Chebyshev / Cauer'} does. A Butterworth |H| is monotonic, so its step always starts and ends at exactly 0 or 1.`,
      }
    } else return {
      kind, prompt: 'Which approximation is it?',
      options: pools.approxes.map(a => ({ id: String(a), label: APPROX_LABELS[a] })),
      answer: String(spec.approx),
      explain: `${APPROX_FACTS[spec.approx]} ${APPROX_CUE[viewId] ?? ''}`.trim(),
    }
    case 'type': return {
      kind, prompt: 'Which type of filter is it?',
      options: pools.types.map(t => ({ id: String(t), label: `${TYPE_SHORT[t]} · ${TYPE_LABELS[t]}` })),
      answer: String(spec.ft),
      explain: `${TYPE_FACTS[spec.ft]} ${TYPE_CUE[viewId] ?? ''}`.trim(),
    }
    case 'order': {
      const p = design.poles.length
      const band = spec.ft === BP || spec.ft === BR
      return {
        kind, prompt: 'What order is H(s)?',
        options: orderOptions(p, rng),
        answer: String(p),
        explain: `H(s) has ${p} poles${band ? ` (a ${ordinal(spec.n)}-order prototype, doubled by the LP → ${TYPE_SHORT[spec.ft]} transform)` : ''}. How to see it here: ${readOrder(spec, viewId)}.`,
      }
    }
    case 'protoOrder': {
      const p = design.poles.length
      const map = spec.ft === BP ? 's → (s² + ω0²) / (B·s)' : 's → B·s / (s² + ω0²)'
      return {
        kind, prompt: 'What order is the LP prototype it came from?',
        options: orderOptions(spec.n, rng),
        answer: String(spec.n),
        explain: `The LP → ${TYPE_SHORT[spec.ft]} transform ${map} turns every prototype pole into a pair, so H(s)'s ${p} poles come from a ${ordinal(spec.n)}-order LP. How to see it here: ${readOrder(spec, viewId)}.`,
      }
    }
    case 'ripple': {
      const ans = RIPPLE_OF[spec.approx]
      return {
        kind, prompt: 'Where does |H| ripple?',
        options: pools.ripples.map(id => ({ id, label: RIPPLE_LABELS[id] })),
        answer: ans,
        explain: `${APPROX_LABELS[spec.approx]}: ${RIPPLE_LABELS[ans].toLowerCase()}. ${viewId === 'poleZero'
          ? 'On the map: jω-axis zeros mean an equiripple stopband, and poles on a flattened ellipse mean passband ripple.'
          : 'Equiripple bands wiggle between two levels; monotonic ones never turn back.'}`,
      }
    }
    case 'stepStart': {
      const { options, answer } = levelOptions(spec, design.hInf)
      return {
        kind, prompt: 'Initial value of the unit step response, y(0⁺)?',
        options, answer,
        explain: `Initial value theorem: y(0⁺) = lim s→∞ s·H(s)·(1/s) = H(∞). ${levelReason('inf', answer, spec)}`,
      }
    }
    case 'stepEnd': {
      const { options, answer } = levelOptions(spec, design.h0)
      return {
        kind, prompt: 'Final value of the unit step response, y(∞)?',
        options, answer,
        explain: `Final value theorem: y(∞) = lim s→0 s·H(s)·(1/s) = H(0). ${levelReason('zero', answer, spec)}`,
      }
    }
    default: throw new Error(`Unknown question kind ${kind}`)
  }
}

const MATCH_CUE = {
  magnitude: 'Reading |H|: poles close to the jω axis make passband ripple peaks, jω-axis zeros make notches, and H(0) / H(∞) set where the curve starts and ends.',
  phase: 'Reading the phase: each pole adds −90° and each zero +90° as ω sweeps past it, jω-axis zeros cause 180° jumps (where |H| has notches), and poles close to the axis make the phase bend sharply.',
  poleZero: 'Reading the map: every notch in |H| is a zero on the jω axis, ripple comes from poles close to the jω axis, and the order is the number of ×.',
  step: 'Reading the step: y(0⁺) = H(∞) and y(∞) = H(0), and the closer the poles are to the jω axis (the more ripple in |H|), the more it overshoots and rings.',
  groupDelay: 'Reading the group delay: it peaks at the band edges, and the closer the poles are to the jω axis (the sharper the approximation), the taller the peak.',
}

/** Given view → the card views allowed by the settings (null when no match round fits). */
function matchPlan(settings) {
  const on = new Set(settings.views?.length ? settings.views : VIEWS.map(v => v.id))
  const stepOk = (settings.approxes?.length ? settings.approxes : GAME_APPROX).some(a => STEP_APPROX.includes(a))
  const usable = id => on.has(id) && (stepOk || id !== 'step')
  const plan = {}
  for (const [given, targets] of Object.entries(MATCH_TARGETS)) {
    if (!usable(given)) continue
    const t = targets.filter(usable)
    if (t.length) plan[given] = t
  }
  return Object.keys(plan).length ? plan : null
}

async function createChoiceRound(api, settings, rng, id) {
  const pools = answerPools(settings)
  const stepApprox = pools.approxes.filter(a => STEP_APPROX.includes(a))
  const useful = v => (v.id !== 'step' || stepApprox.length > 0)
    && v.questions.some(k => !BAND_ONLY.has(k) && !trivialKind(k, pools))
  const views = VIEWS.filter(v => settings.views.includes(v.id) && useful(v))
  const pool = views.length ? views : VIEWS.filter(useful)
  let lastErr = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const view = pick(pool, rng)
    // Aa up to 40 dB unless the questions end up depending on the stopband (below)
    let spec = randomSpec(view.id === 'step' ? { ...settings, approxes: stepApprox } : settings, rng, false)
    let design
    try { design = await buildDesign(api, spec) } catch (e) { lastErr = e; continue }
    if (view.id === 'step' && !design.step) continue
    const asks = k => {
      if (!isBandType(spec.ft) && BAND_ONLY.has(k)) return false
      if (view.id === 'step' && k === 'approx') return stepApproxAnswerable(spec, design, pools)
      return !trivialKind(k, pools)
    }
    const avail = view.questions.filter(asks)
    if (!avail.length) continue
    const count = Math.min(avail.length, CHOICE_QUESTIONS)
    // Keep the view's canonical order after picking the subset
    const kinds = shuffle(avail, rng).slice(0, count)
      .sort((a, b) => avail.indexOf(a) - avail.indexOf(b))
    // A stopband-ripple filter asked about anything but its type: redesign with Aa ≤ 30 dB
    if (STOP_RIPPLE.has(spec.approx) && kinds.some(k => k !== 'type') && !AA_CLEAR.includes(spec.aaDb)) {
      spec = makeSpec(spec.approx, spec.ft, spec.n, { ...spec.shape, aaDb: pick(AA_CLEAR, rng) })
      try { design = await buildDesign(api, spec) } catch (e) { lastErr = e; continue }
      if (view.id === 'step' && !design.step) continue
    }
    const questions = kinds.map(k => makeQuestion(k, view.id, spec, design, rng, pools))
    return { id, kind: 'choice', spec, view, design, questions }
  }
  throw lastErr ?? new Error('Could not build a round')
}

/**
 * Match round: given one view of a filter, 4 cards of other views, each either
 * the same filter or a distractor; 1–4 of them are correct (multi-select).
 * Cards mix at least 2 views when the settings allow it, a correct card never
 * repeats a view (it would be the same picture twice), at least 2 cards have
 * the right filter type, and no Legendre appears when a step response is shown.
 */
async function createMatchRound(api, settings, rng, id, plan) {
  let lastErr = null
  for (let attempt = 0; attempt < 8; attempt++) {
    const givenId = pick(Object.keys(plan), rng)
    const targets = plan[givenId]
    const k = randInt(1, Math.min(4, targets.length), rng)
    const correctViews = shuffle(targets, rng).slice(0, k)
    const wrongViews = Array.from({ length: 4 - k }, () => pick(targets, rng))
    // Mixed plot kinds, not 4 of the same one
    if (targets.length > 1 && new Set([...correctViews, ...wrongViews]).size < 2) {
      wrongViews[0] = pick(targets.filter(t => t !== correctViews[0]), rng)
    }
    const cardViews = [...correctViews, ...wrongViews]
    const needsStep = givenId === 'step' || cardViews.includes('step')

    const enabled = settings.approxes?.length ? settings.approxes : GAME_APPROX
    const st = { ...settings, approxes: needsStep ? enabled.filter(a => STEP_APPROX.includes(a)) : enabled }
    const spec = randomSpec(st, rng)
    // Same-type distractors come first, so with k = 1 the type still can't give it away
    const wrongSpecs = (distractorSpecs(spec, st, rng, needsStep ? STEP_APPROX : GAME_APPROX) ?? []).slice(0, 4 - k)
    if (wrongSpecs.length !== 4 - k) continue
    // One frequency axis for every card: a band filter's narrower window would give its type away
    const range = freqRangeHz(spec.ft)
    let designs
    try { designs = await Promise.all([spec, ...wrongSpecs].map(s => buildDesign(api, s, 2000, range))) } catch (e) { lastErr = e; continue }
    if (needsStep && designs.some(d => !d.step)) continue

    const cards = [
      ...correctViews.map(v => ({ view: v, spec, design: designs[0], correct: true })),
      ...wrongViews.map((v, i) => ({ view: v, spec: wrongSpecs[i], design: designs[i + 1], correct: false })),
    ]
    const order = shuffle(cards, rng)
    const options = order.map((c, slot) => ({
      id: String(slot),
      tag: MATCH_NOUN[c.view],
      label: `${describeSpec(c.spec, c.design)}${c.correct ? ' (same filter)' : ''}`,
      round: { id: `${id}:${slot}`, spec: c.spec, view: viewById(c.view), design: c.design },
    }))
    const answer = options.filter((_, slot) => order[slot].correct).map(o => o.id)
    const shownViews = [...new Set(order.map(c => c.view))]
    const question = {
      kind: 'match', type: 'match', multi: true,
      prompt: 'Which plots belong to the same filter?',
      options, answer,
      explain: `The given ${MATCH_NOUN[givenId]} is a ${describeSpec(spec, designs[0])}: ${plural(answer.length, 'card')} ${answer.length === 1 ? 'shows' : 'show'} it (${answer.map(a => Number(a) + 1).join(', ')}). ${shownViews.map(v => MATCH_CUE[v]).join(' ')}`,
    }
    return { id, kind: 'match', spec, view: viewById(givenId), design: designs[0], questions: [question] }
  }
  throw lastErr ?? new Error('Could not build a round')
}

// ── Line-up: one template, several approximations overlaid ─────────────────

/** Views a line-up can overlay (as in the guide's figures 3.15–3.29). */
export const LINEUP_VIEWS = ['magnitude', 'phase', 'poleZero']
/** Curve colours per slot: never tied to the approximation, or they'd give it away. */
export const LINEUP_SLOTS = [
  { slot: 'A', color: '#00bcd4' },
  { slot: 'B', color: '#ff9800' },
  { slot: 'C', color: '#e040fb' },
  { slot: 'D', color: '#c6ff00' },
]
/** Highest order a line-up curve may need (keeps the overlay readable). */
const LINEUP_MAX_N = { lp: 10, band: 7 }

/** How each approximation stands out in an overlay, per view. */
const LINEUP_CUE = {
  magnitude: [
    'monotonic and the gentlest edge: it needs the highest order',
    'ripple in the passband, monotonic stopband',
    'flat passband, notches in the stopband',
    'ripple in both bands and the steepest edge: the lowest order',
    'monotonic like Butterworth but steeper, with a slight droop before the edge',
  ],
  phase: [
    'smooth, no jumps, and the most total phase (the highest order)',
    'no jumps, and the sharpest bend at the band edge among the all-pole ones',
    '180° jumps at its stopband notches, with a gentle bend at the edge',
    '180° jumps and the sharpest bend at the edge',
    'no jumps, bending between Butterworth and Chebyshev I',
  ],
  poleZero: [
    'poles on a circle, no finite zeros',
    'poles on a flattened ellipse close to the jω axis, no finite zeros',
    'zeros on the jω axis, poles well away from it',
    'zeros on the jω axis and poles hugging it near the band edge',
    'no finite zeros; poles near Butterworth\'s but crowding the jω axis at the edge',
  ],
}

function lineupPossible(settings) {
  const approxes = (settings.approxes?.length ? settings.approxes : GAME_APPROX)
  const views = LINEUP_VIEWS.filter(v => (settings.views?.length ? settings.views : LINEUP_VIEWS).includes(v))
  return approxes.length >= 3 && views.length > 0
}

/** The same template designed with each approximation, each at its minimum order. */
async function lineupDesigns(api, ft, approxes, shape) {
  const cap = isBandType(ft) ? LINEUP_MAX_N.band : LINEUP_MAX_N.lp
  const range = freqRangeHz(ft)
  const out = []
  for (const approx of approxes) {
    const spec = makeSpec(approx, ft, 1, shape)
    // One above the cap: landing there means the template needs more than we allow
    spec.form = { ...spec.form, nMin: 1, nMax: cap + 1 }
    spec.params = { ...spec.params, N_min: 1, N_max: cap + 1 }
    const design = await buildDesign(api, spec, 2000, range)
    // Order 1 curves all look alike, and a 2nd-order Legendre is Butterworth
    if (design.N > cap || design.N < 2 || (approx === 4 && design.N < 3)) return null
    out.push({ spec: { ...spec, n: design.N }, design })
  }
  return out
}

async function createLineupRound(api, settings, rng, id) {
  const enabled = settings.approxes?.length ? settings.approxes : GAME_APPROX
  const views = LINEUP_VIEWS.filter(v => settings.views.includes(v))
  const types = settings.types?.length ? settings.types : GAME_TYPES
  let lastErr = null
  // Selective templates push Butterworth past the cap: retry with another shape
  for (let attempt = 0; attempt < 40; attempt++) {
    const ft = pick(types, rng)
    const count = Math.min(enabled.length, enabled.length >= 4 && rng() < 0.5 ? 4 : 3)
    const approxes = shuffle(enabled, rng).slice(0, count)
    let members
    try { members = await lineupDesigns(api, ft, approxes, randomShape(rng)) } catch (e) { lastErr = e; continue }
    if (!members) continue
    const view = viewById(pick(views, rng))
    const lineup = members.map((m, i) => ({ ...LINEUP_SLOTS[i], ...m }))
    const listed = [...approxes].sort((a, b) => a - b)
    const questions = lineup.map(m => ({
      kind: 'lineup',
      prompt: `Which approximation is curve ${m.slot}?`,
      swatch: m.color,
      options: listed.map(a => ({ id: String(a), label: APPROX_LABELS[a] })),
      answer: String(m.spec.approx),
      explain: `${m.slot} is the ${describeSpec(m.spec, m.design)}: ${LINEUP_CUE[view.id][m.spec.approx]}. Same template, each at its minimum order, so the orders rank Cauer ≤ Chebyshev I = Chebyshev II ≤ Legendre ≤ Butterworth (ties possible).`,
    }))
    return { id, kind: 'lineup', spec: lineup[0].spec, view, design: lineup[0].design, lineup, questions }
  }
  throw lastErr ?? new Error('Could not build a line-up')
}

// ── Theory cards ────────────────────────────────────────────────────────────

const CARD_VIEW = { id: 'card', label: 'Theory card', title: 'Theory card' }

function createTheoryRound(settings, rng, id) {
  const enabled = settings.approxes?.length ? settings.approxes : GAME_APPROX
  const q = makeTheoryQuestion(enabled, rng)
  if (!q) return null
  return { id, kind: 'theory', spec: null, view: CARD_VIEW, design: null, card: q.card, questions: [q] }
}

/** Is `picked` (an option id, or an id array for multi-select) right? */
export function isCorrect(q, picked) {
  if (!q.multi) return picked === q.answer
  const a = new Set(q.answer), p = new Set(picked ?? [])
  return a.size === p.size && [...a].every(x => p.has(x))
}

/** Has the question been answered (multi-select: at least one option picked)? */
export const isAnswered = (q, picked) => (q.multi ? (picked?.length ?? 0) > 0 : picked != null)

/**
 * Create a full round of a random enabled kind. Retries on the (rare) specs
 * the engine refuses or whose step response can't be computed.
 */
export async function createRound(api, settings = DEFAULT_SETTINGS, rng = Math.random, id = 0) {
  const kinds = settings.kinds?.length ? settings.kinds : DEFAULT_SETTINGS.kinds
  const plan = matchPlan(settings)
  const ok = {
    choice: true,
    match: !!plan,
    lineup: lineupPossible(settings),
    theory: true,
  }
  const avail = kinds.filter(k => ok[k])
  const kind = avail.length ? pick(avail, rng) : 'choice'
  if (kind === 'theory') {
    const r = createTheoryRound(settings, rng, id)
    if (r) return r
  }
  if (kind === 'lineup') return createLineupRound(api, settings, rng, id)
  if (kind === 'match') return createMatchRound(api, settings, rng, id, plan)
  return createChoiceRound(api, settings, rng, id)
}

/** One-line reveal of what the round was (null for a theory card). */
export function describeRound(round) {
  if (round.kind === 'theory') return null
  if (round.kind === 'lineup') return round.lineup.map(m => `${m.slot}: ${describeSpec(m.spec, m.design)}`).join(' · ')
  return `It was a ${describeSpec(round.spec, round.design)}.`
}

/** One-line reveal of what the round was. */
export function describeSpec(spec, design) {
  const p = design?.poles?.length ?? spec.n
  return `${ordinal(p)}-order ${APPROX_LABELS[spec.approx]} ${TYPE_LABELS[spec.ft].toLowerCase()}`
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Spec line shown with the plot (never gives the answers away). */
export function givenLine(spec, round = null) {
  if (round?.kind === 'theory') return 'No plot: from what you know about each approximation.'
  if (round?.kind === 'lineup') return `One template, ${round.lineup.length} approximations, each at its minimum order · Ap = ${spec.apDb} dB · Aa = ${spec.aaDb} dB`
  return `Ap = ${spec.apDb} dB · Aa = ${spec.aaDb} dB · band edges normalized around 1 rad/s`
}

/** TeX axis labels per view (kept in .js so Svelte never sees `$x` tokens). */
export const PLOT_LABELS = {
  freq: '$\\omega\\ [\\mathrm{rad/s}]$',
  time: '$t\\ [\\mathrm{s}]$',
  magnitude: '$|H(j\\omega)|\\ [\\mathrm{dB}]$',
  phase: '$\\angle H(j\\omega)\\ [^\\circ]$',
  groupDelay: '$\\tau(\\omega)\\ [\\mathrm{s}]$',
  step: '$y(t)$',
  re: '$\\sigma\\ [\\mathrm{rad/s}]$',
  im: '$j\\omega\\ [\\mathrm{rad/s}]$',
}
