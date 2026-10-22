// Bode response straight from a design's zeros / poles (pure, worker-safe).
//
// The engine's computeBode(num, den) re-roots the expanded polynomials, which
// breaks down for high-order designs (an order-50 Butterworth, a BR built from
// an order-11 prototype = degree 22 at ω ~ 1e4…1e5 rad/s): the readouts then
// show −Infinity or thousands of dB. Evaluating the factored form in log
// space keeps every order finite. Same output shape and sampling as the
// engine's compute_bode (freq in Hz, linear magnitude, phase in degrees,
// group delay in seconds).

/**
 * @param {[number, number][]} zeros  [re, im] in rad/s
 * @param {[number, number][]} poles  [re, im] in rad/s
 * @param {number} k  leading gain: H(s) = k · Π(s − z) / Π(s − p)
 */
export function bodeFromZpk(zeros, poles, k, minHz, maxHz, points) {
  const lo = Math.log10(minHz), hi = Math.log10(maxHz)
  const freq = new Array(points)
  for (let i = 0; i < points; i++) freq[i] = 10 ** (lo + (points === 1 ? 0 : i / (points - 1)) * (hi - lo))
  return bodeAtZpk(zeros, poles, k, freq)
}

/**
 * Same response on an arbitrary frequency list (Hz). `evalAt` (default: the
 * list itself) is where it is actually evaluated, so a plotted f = 0 can be
 * evaluated just above DC.
 */
export function bodeAtZpk(zeros, poles, k, freq, evalAt = freq) {
  const points = freq.length
  const magnitude = new Array(points)
  const phase = new Array(points), groupDelay = new Array(points)
  const logK = Math.log(Math.abs(k) || 1e-300)
  const kPhase = k < 0 ? Math.PI : 0
  for (let i = 0; i < points; i++) {
    const w = 2 * Math.PI * evalAt[i]
    let logMag = logK, ph = kPhase, tau = 0
    for (const [re, im] of zeros) {
      const dr = -re, di = w - im
      logMag += 0.5 * Math.log(Math.max(dr * dr + di * di, 1e-600))
      ph += Math.atan2(di, dr)
      tau += re / (re * re + di * di)
    }
    for (const [re, im] of poles) {
      const dr = -re, di = w - im
      logMag -= 0.5 * Math.log(Math.max(dr * dr + di * di, 1e-600))
      ph -= Math.atan2(di, dr)
      tau -= re / (re * re + di * di)
    }
    magnitude[i] = Math.exp(logMag)
    phase[i] = (ph * 180) / Math.PI
    groupDelay[i] = Number.isFinite(tau) ? tau : 0
  }
  return { freq: Array.from(freq), magnitude, phase, groupDelay }
}

// ── DC lead ──────────────────────────────────────────────────────────────────
// A Bode starts at its lowest designed frequency (log grid). Plots whose x axis
// is linear or sinh reach 0 Hz, so they prepend this short linear segment.

export const DC_LEAD_POINTS = 32

/** Plotted frequencies (Hz) from 0 up to, not including, `minHz`. */
export const dcLeadFreqs = minHz => Array.from({ length: DC_LEAD_POINTS }, (_, i) => (i * minHz) / DC_LEAD_POINTS)

/** Where to evaluate those: the f = 0 point just above DC (zeros at the origin have no phase at exactly 0). */
export const dcEvalFreqs = lead => lead.map(f => (f > 0 ? f : lead[1] * 1e-6))

const leadCache = new WeakMap()

/**
 * `bode` of a design with the response from 0 Hz prepended (same shape), or
 * `bode` itself when it can't be extended. `result` is the design it belongs to.
 */
export function withDcLead(bode, result) {
  if (!(bode?.freq?.[0] > 0) || !result?.poles) return bode
  let out = leadCache.get(bode)
  if (out) return out
  const lead = dcLeadFreqs(bode.freq[0])
  const head = bodeAtZpk(result.zeros, result.poles, designGain(result), lead, dcEvalFreqs(lead))
  out = {
    freq: [...head.freq, ...bode.freq],
    magnitude: [...head.magnitude, ...bode.magnitude],
    phase: [...head.phase, ...bode.phase],
    groupDelay: [...head.groupDelay, ...bode.groupDelay],
  }
  leadCache.set(bode, out)
  return out
}

/**
 * |H(jω)| of k·Π(s − z)/Π(s − p) at one ω (rad/s); ω = Infinity gives the
 * high-frequency limit. Factored, so it stays exact at any order.
 */
export function magAtZpk(zeros, poles, k, w) {
  if (w === Infinity) return zeros.length === poles.length ? Math.abs(k) : zeros.length < poles.length ? 0 : Infinity
  let logM = Math.log(Math.abs(k))
  for (const [re, im] of zeros) logM += Math.log(Math.hypot(re, w - im))
  for (const [re, im] of poles) logM -= Math.log(Math.hypot(re, w - im))
  return Math.exp(logM)
}

/** Leading gain k of an engine design (num is k·Π(s − z), den is monic). */
export function designGain(result) {
  const k = result.num?.[0] / result.den?.[0]
  return Number.isFinite(k) ? k : 1
}

/** Bode of an engine design through the worker (factored form, see above). */
export const designBode = (api, result, minHz, maxHz, points) =>
  api.computeBodeZpk(result.zeros, result.poles, designGain(result), minHz, maxHz, points)
