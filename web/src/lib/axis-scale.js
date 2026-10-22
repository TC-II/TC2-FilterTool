// Axis scales for the magnitude plots.
//
// A scale maps a data value to the value Plotly draws:
//   x: frequency in plot units (Hz or rad/s)   y: magnitude in dB
// { kind, sig, mapped, plotlyType, fwd, inv, ticks }
//   sig         changes whenever the mapping does (kind + knee)
//   mapped      fwd is not the identity: traces and shapes must be mapped
//   plotlyType  Plotly axis type of the mapped values ('log' | 'linear')
//   fwd / inv   data → plotted / plotted → data (null stays null)
//   ticks       (lo, hi) → { tickvals, ticktext } for a plotted range, or
//               null when Plotly's own ticks are right
//
// sinh is asinh(v / knee): linear below the knee (so 0 and negative values
// exist, unlike log), logarithmic above it.

import { formatSI } from './si.js'

const MAX_DB = 400   // finite stand-in for ±Infinity / ±1e4 "open" template edges
const clampDb = db => Math.max(-MAX_DB, Math.min(MAX_DB, db))
const fromDb = db => 10 ** (clampDb(db) / 20)
const toDb = v => (v > 10 ** (-MAX_DB / 20) ? 20 * Math.log10(v) : -MAX_DB)

const num = fn => v => (v == null || Number.isNaN(v) ? null : fn(v))

export const IDENTITY = Object.freeze({
  kind: 'id', sig: 'id', mapped: false, plotlyType: 'linear', fwd: v => v, inv: v => v, ticks: null,
})

/** Plain number, 3 significant figures (|H| ticks: 0.5, 0.01, 2). */
const plain = v => (v === 0 ? '0' : parseFloat(v.toPrecision(3)).toString())

/**
 * Round tick values (0, ±1/2/5·10^k) for a sinh axis showing plotted range
 * [lo, hi]. Candidates are taken round-first (decades, then 5s, then 2s) and
 * dropped when they would sit closer than ~4 % of the axis to one already kept.
 */
function sinhTicks(knee, format) {
  return (lo, hi) => {
    if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
    const vLo = knee * Math.sinh(lo), vHi = knee * Math.sinh(hi)
    const vMax = Math.max(Math.abs(vLo), Math.abs(vHi))
    const k0 = Math.floor(Math.log10(knee)) - 1
    const k1 = Math.min(Math.ceil(Math.log10(vMax)), k0 + 40)
    const cands = []
    for (const m of [1, 5, 2]) {
      for (let k = k0; k <= k1; k++) {
        const v = m * 10 ** k
        if (v >= vLo && v <= vHi) cands.push(v)
        if (-v >= vLo && -v <= vHi) cands.push(-v)
      }
    }
    const gap = 0.04 * (hi - lo)
    const kept = []
    for (const v of (vLo <= 0 && vHi >= 0 ? [0, ...cands] : cands)) {
      const u = Math.asinh(v / knee)
      if (kept.every(t => Math.abs(t.u - u) >= gap)) kept.push({ v, u })
    }
    kept.sort((a, b) => a.u - b.u)
    return { tickvals: kept.map(t => t.u), ticktext: kept.map(t => format(t.v)) }
  }
}

/**
 * x scale for a frequency axis. `knee` (plot units) is where sinh turns from
 * linear to logarithmic.
 * @param {'lin'|'log'|'sinh'} kind
 * @param {number} knee
 */
export function freqScale(kind, knee) {
  if (kind === 'log') return { kind, sig: kind, mapped: false, plotlyType: 'log', fwd: v => v, inv: v => v, ticks: null }
  if (kind === 'sinh' && knee > 0) {
    return {
      kind, sig: `${kind}:${knee}`, mapped: true, plotlyType: 'linear',
      fwd: num(v => Math.asinh(v / knee)),
      inv: num(u => knee * Math.sinh(u)),
      ticks: sinhTicks(knee, formatSI),
    }
  }
  return { kind: 'lin', sig: 'lin', mapped: false, plotlyType: 'linear', fwd: v => v, inv: v => v, ticks: null }
}

/**
 * x scale and explicit range for a frequency axis fitted to [min, max] (plot
 * units). Linear and sinh run down to DC; sinh turns logarithmic at `min`.
 * `range` is what a log axis would get too, so callers that let Plotly
 * autorange a log axis can pass null instead.
 * @param {'lin'|'log'|'sinh'} kind
 */
export function freqSetup(kind, min, max) {
  return {
    scale: freqScale(kind, min),
    range: kind === 'log' ? [min, max] : [0, max],
  }
}

/**
 * y scale for a magnitude axis; data values are dB. `knee` is the linear |H|
 * where sinh turns from linear to logarithmic.
 * @param {'db'|'lin'|'sinh'} kind
 * @param {number} knee
 */
export function magScale(kind, knee) {
  if (kind === 'lin') {
    return { kind, sig: kind, mapped: true, plotlyType: 'linear', fwd: num(fromDb), inv: num(toDb), ticks: null }
  }
  if (kind === 'sinh' && knee > 0) {
    return {
      kind, sig: `${kind}:${knee}`, mapped: true, plotlyType: 'linear',
      fwd: num(db => Math.asinh(fromDb(db) / knee)),
      inv: num(u => toDb(knee * Math.sinh(u))),
      ticks: sinhTicks(knee, plain),
    }
  }
  return { kind: 'db', sig: 'db', mapped: false, plotlyType: 'linear', fwd: v => v, inv: v => v, ticks: null }
}

/** Graph-div pixel (relative to the plot div) of a data value on a Plotly axis. */
export const toPx = (ax, scale, v) => ax._offset + ax.l2p(ax.d2l((scale ?? IDENTITY).fwd(v)))

/** Data value under a pixel (relative to the plot div) on a Plotly axis. */
export const fromPx = (ax, scale, px) => (scale ?? IDENTITY).inv(ax.l2d(ax.p2l(px - ax._offset)))
