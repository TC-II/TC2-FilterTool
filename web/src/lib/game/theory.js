// Game mode: theory flash cards (TC2 Guía 3, ej. 3.43 / 3.25 / 3.12).
// Pure data + logic, no plot: "which approximations have property X?" and
// "which of these hold for approximation Y?", both multi-select.
//
// Answer sets use the engine's approximation indices:
//   0 Butterworth · 1 Chebyshev I · 2 Chebyshev II · 3 Cauer · 4 Legendre · 5 Bessel
// The order rankings were checked against the engine over 170 LP templates
// (k = 1.2–8, Ap = 0.1–3 dB, Aa = 20–60 dB): Cauer ≤ Cheby I = Cheby II ≤
// Legendre ≤ Butterworth always holds, with ties. Cheby I had higher-Q poles
// than Cheby II in every case; the highest-Q approximation overall was usually
// Chebyshev I, not Cauer, so there is no "highest Q" card.

export const THEORY_LABELS = ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Legendre', 'Bessel']
const BESSEL = 5

/**
 * prop     — the property, phrased so it reads both as "Which have: <prop>?"
 *            and as an option under "<approx>: which of these hold?"
 * answer   — approximations that have it
 * relative — a superlative ("the lowest order…"): only asked when every answer
 *            is among the listed options, or it would change meaning
 * only     — fixed option list (a head-to-head card); forward direction only
 * bessel   — also list Bessel as an option
 * exclude  — never an option (the card names it)
 */
export const THEORY_CARDS = [
  { id: 'passRipple', prop: 'Ripple in the passband', answer: [1, 3],
    explain: 'Chebyshev I and Cauer trade passband flatness for a steeper edge: |H| bounces between 0 dB and −Ap across the passband.' },
  { id: 'stopRipple', prop: 'Ripple in the stopband', answer: [2, 3],
    explain: 'Chebyshev II and Cauer have zeros on the jω axis: between the notches |H| comes back up to −Aa, so the stopband is equiripple.' },
  { id: 'tzeros', prop: 'Transmission zeros (finite zeros on the jω axis)', answer: [2, 3], bessel: true,
    explain: 'Only Chebyshev II and Cauer have finite zeros; they sit on the jω axis and make the stopband notches. Butterworth, Chebyshev I, Legendre and Bessel are all-pole.' },
  { id: 'allPole', prop: 'All-pole H(s) (every zero at ∞)', answer: [0, 1, 4, 5], bessel: true,
    explain: 'Butterworth, Chebyshev I, Legendre and Bessel have a constant numerator. Chebyshev II and Cauer add jω-axis zeros.' },
  { id: 'monotonic', prop: 'Monotonic |H| in both bands', answer: [0, 4, 5], bessel: true,
    explain: 'Butterworth, Legendre and Bessel never turn back. Chebyshev I ripples in the passband, Chebyshev II in the stopband, Cauer in both.' },
  { id: 'maxFlat', prop: 'Maximally flat |H| at ω = 0', answer: [0, 2],
    explain: 'Butterworth is the textbook case, and Chebyshev II too: 1 − |H|² grows like ω²ⁿ near DC, so its first 2n − 1 derivatives vanish there. Chebyshev I / Cauer ripple and Legendre trades flatness for roll-off.' },
  { id: 'jumps', prop: '180° jumps in the phase', answer: [2, 3], bessel: true,
    explain: 'The phase jumps 180° where |H| crosses a jω-axis zero: only Chebyshev II and Cauer have them.' },
  { id: 'stepParity', prop: 'Low-pass step final value y(∞) depends on whether the order is even or odd', answer: [1, 3],
    explain: 'y(∞) = H(0). An even-order Chebyshev I / Cauer sits at the bottom of the passband ripple at DC, 10^(−Ap/20); an odd order sits at 1. Everyone else has H(0) = 1.' },
  { id: 'hinfFloor', prop: 'Even-order low-pass levels off at −Aa instead of falling forever', answer: [2, 3],
    explain: 'An even-order Chebyshev II / Cauer has as many finite zeros as poles, so H(∞) is the stopband ripple level and the asymptotic slope is 0 dB/dec. Odd orders keep falling at −20 dB/dec.' },
  { id: 'poleCircle', prop: 'Poles on a circle', answer: [0], bessel: true,
    explain: 'Butterworth poles sit evenly spaced on a circle of radius ωc. Chebyshev I squashes that circle into an ellipse; Bessel poles lie on a curve farther from the jω axis.' },
  { id: 'poleEllipse', prop: 'Poles on an ellipse', answer: [1],
    explain: 'Chebyshev I poles lie on an ellipse whose minor axis shrinks as Ap grows, pushing them towards the jω axis (hence the higher Q).' },
  { id: 'flatDelay', prop: 'Flattest group delay (least phase distortion) in the passband', answer: [5], bessel: true, relative: true,
    explain: 'Bessel is maximally flat in group delay: the phase is as linear as an all-pole filter can make it. The price is the gentlest magnitude roll-off.' },
  { id: 'minOrder', prop: 'Lowest order for a given template', answer: [3], relative: true,
    explain: 'Cauer spends ripple in both bands and places zeros on the jω axis, so it meets any template with the lowest order. Ranking (ties possible): Cauer ≤ Chebyshev I = Chebyshev II ≤ Legendre ≤ Butterworth.' },
  { id: 'maxOrder', prop: 'Highest order for a given template', answer: [0], relative: true,
    explain: 'Butterworth\'s maximally flat passband costs the most order. Ranking (ties possible): Cauer ≤ Chebyshev I = Chebyshev II ≤ Legendre ≤ Butterworth.' },
  { id: 'minOrderFlat', prop: 'Lowest order with no passband ripple', answer: [2], relative: true,
    explain: 'Chebyshev II needs the same order as Chebyshev I but keeps the passband monotonic: all its ripple is in the stopband.' },
  { id: 'minOrderAllPole', prop: 'Lowest order with no transmission zeros', answer: [1], relative: true,
    explain: 'Among the all-pole approximations, Chebyshev I is the most selective: its passband ripple buys the steepest edge without finite zeros.' },
  { id: 'minOrderMono', prop: 'Lowest order with a monotonic |H|', answer: [4], relative: true,
    explain: 'Legendre (optimum-L) has the steepest roll-off a monotonic response can have, so it never needs a higher order than Butterworth.' },
  { id: 'sameAsChebI', prop: 'Always needs the same order as Chebyshev I', answer: [2], exclude: [1], relative: true,
    explain: 'Both come from the same Chebyshev polynomial Tₙ, so the order formula is identical: n = ⌈acosh(√((10^(Aa/10) − 1)/(10^(Ap/10) − 1))) / acosh(ωa/ωp)⌉.' },
  { id: 'chebQ', prop: 'Higher-Q poles for the same template', answer: [1], only: [1, 2],
    explain: 'Chebyshev I puts its poles on an ellipse close to the jω axis (passband ripple = resonant poles). Chebyshev II poles sit farther from the axis: the selectivity comes from its jω-axis zeros instead.' },
]

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)]
function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Options a card can list, given the enabled game approximations. */
function cardOptions(card, enabled) {
  if (card.only) return card.only.filter(a => enabled.includes(a)).length === card.only.length ? [...card.only] : []
  const pool = [...enabled.filter(a => a !== BESSEL), ...(card.bessel ? [BESSEL] : [])]
  return pool.filter(a => !(card.exclude ?? []).includes(a))
}

/** Forward card: "Which approximations have <prop>?" — null when it can't be asked fairly. */
function forwardQuestion(card, enabled) {
  const opts = cardOptions(card, enabled)
  const answer = card.answer.filter(a => opts.includes(a))
  if (opts.length < 2 || !answer.length) return null
  if (card.relative && answer.length !== card.answer.length) return null
  if (answer.length === opts.length) return null      // "all of them" is no question
  return {
    kind: 'theory', multi: !card.only,
    prompt: card.only ? 'Which of the two?' : 'Which approximations have this property?',
    card: card.prop, cardLabel: card.only ? 'HEAD TO HEAD' : 'PROPERTY',
    options: opts.map(a => ({ id: String(a), label: THEORY_LABELS[a] })),
    // Multi-select answers are id arrays; a head-to-head card has one answer
    answer: card.only ? String(answer[0]) : answer.map(String),
    explain: card.explain,
  }
}

/** Reverse card: "<approx>: which of these hold?" over 4 properties (1–3 true). */
function reverseQuestion(approx, enabled, rng) {
  const usable = THEORY_CARDS.filter(c => !c.only && !(c.exclude ?? []).includes(approx)
    && (!c.relative || c.answer.every(a => cardOptions(c, enabled).includes(a))))
  const yes = shuffle(usable.filter(c => c.answer.includes(approx)), rng)
  const no = shuffle(usable.filter(c => !c.answer.includes(approx)), rng)
  if (!yes.length || no.length < 1) return null
  const nYes = Math.min(yes.length, 1 + Math.floor(rng() * 3), 3)
  const chosen = shuffle([...yes.slice(0, nYes), ...no.slice(0, 4 - nYes)], rng)
  if (chosen.length < 3) return null
  const why = chosen.map(c => `${c.answer.includes(approx) ? '✓' : '✗'} ${c.prop}: ${c.explain}`).join('\n')
  return {
    kind: 'theory', multi: true,
    prompt: 'Which of these hold for it?',
    card: THEORY_LABELS[approx], cardLabel: 'APPROXIMATION',
    options: chosen.map(c => ({ id: c.id, label: c.prop })),
    answer: chosen.filter(c => c.answer.includes(approx)).map(c => c.id),
    explain: why,
  }
}

/**
 * One flash card round. `enabled` are the game approximations switched on in
 * Options (Bessel is theory-only and joins the cards that mention it).
 */
export function makeTheoryQuestion(enabled, rng = Math.random) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const q = rng() < 0.6
      ? forwardQuestion(pick(THEORY_CARDS, rng), enabled)
      : reverseQuestion(pick(enabled.filter(a => a !== BESSEL), rng), enabled, rng)
    if (q) return q
  }
  return null
}

/** Every forward card that the given approximations allow (for tests). */
export const forwardCards = enabled => THEORY_CARDS.map(c => forwardQuestion(c, enabled)).filter(Boolean)
