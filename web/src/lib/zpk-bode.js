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
  const freq = new Array(points), magnitude = new Array(points)
  const phase = new Array(points), groupDelay = new Array(points)
  const lo = Math.log10(minHz), hi = Math.log10(maxHz)
  const logK = Math.log(Math.abs(k) || 1e-300)
  const kPhase = k < 0 ? Math.PI : 0
  for (let i = 0; i < points; i++) {
    const t = points === 1 ? 0 : i / (points - 1)
    const f = 10 ** (lo + t * (hi - lo))
    const w = 2 * Math.PI * f
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
    freq[i] = f
    magnitude[i] = Math.exp(logMag)
    phase[i] = (ph * 180) / Math.PI
    groupDelay[i] = Number.isFinite(tau) ? tau : 0
  }
  return { freq, magnitude, phase, groupDelay }
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
