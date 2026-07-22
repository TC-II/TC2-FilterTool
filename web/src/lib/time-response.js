/**
 * Continuous-time impulse / step response from ZPK via residue expansion.
 * Matches the scipy.signal.impulse / step approach used by the desktop app
 * (analytical residues + default settling-time window).
 */

function c(re, im = 0) {
  return { re, im }
}

function cadd(a, b) {
  return c(a.re + b.re, a.im + b.im)
}

function csub(a, b) {
  return c(a.re - b.re, a.im - b.im)
}

function cmul(a, b) {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
}

function cdiv(a, b) {
  const d = b.re * b.re + b.im * b.im
  if (!(d > 0)) return c(NaN, NaN)
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}

function cexp(a) {
  const e = Math.exp(a.re)
  return c(e * Math.cos(a.im), e * Math.sin(a.im))
}

function fromPair([re, im]) {
  return c(re, im)
}

/** Residues of H(s) = gain · Π(s−z)/Π(s−p) at each pole (assumes distinct poles). */
function residues(zeros, poles, gain) {
  return poles.map((p, i) => {
    const pc = fromPair(p)
    let num = c(gain, 0)
    for (const z of zeros) num = cmul(num, csub(pc, fromPair(z)))
    let den = c(1, 0)
    for (let k = 0; k < poles.length; k++) {
      if (k === i) continue
      den = cmul(den, csub(pc, fromPair(poles[k])))
    }
    return cdiv(num, den)
  })
}

/** H(0) = gain · Π(−z)/Π(−p) */
function evalH0(zeros, poles, gain) {
  let num = c(gain, 0)
  let den = c(1, 0)
  for (const z of zeros) num = cmul(num, c(-z[0], -z[1]))
  for (const p of poles) den = cmul(den, c(-p[0], -p[1]))
  return cdiv(num, den).re
}

/** Settling duration from the slowest stable pole (min |Re|). */
export function responseDuration(poles) {
  let rSlow = Infinity
  for (const p of poles ?? []) {
    const ar = Math.abs(Number(p[0]) || 0)
    if (ar > 1e-12) rSlow = Math.min(rSlow, ar)
  }
  if (!Number.isFinite(rSlow)) rSlow = 1
  // ~10 time constants of the slowest mode → plot reaches steady state
  return 10 / rSlow
}

function makeTimes(tEnd, n) {
  const points = Math.max(2, Math.floor(n) || 5000)
  const end = Number.isFinite(tEnd) && tEnd > 0 ? tEnd : 1
  const time = new Array(points)
  for (let i = 0; i < points; i++) {
    time[i] = (end * i) / (points - 1)
  }
  return time
}

function sanitizeZpk(zeros, poles, gain) {
  const zs = (zeros ?? []).map(([re, im]) => [Number(re) || 0, Number(im) || 0])
  const ps = (poles ?? []).map(([re, im]) => [Number(re) || 0, Number(im) || 0])
  const k = Number(gain)
  if (!ps.length || !Number.isFinite(k)) return null
  // Reject clearly repeated poles (rare for these approximations).
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const dr = ps[i][0] - ps[j][0]
      const di = ps[i][1] - ps[j][1]
      if (dr * dr + di * di < 1e-20) return null
    }
  }
  return { zeros: zs, poles: ps, gain: k }
}

/**
 * @param {number} [tEnd] shared time horizon (seconds); defaults from this filter's poles
 * @returns {{ time: number[], value: number[] } | null}
 */
export function computeImpulse(zeros, poles, gain, numPoints = 5000, tEnd) {
  const zpk = sanitizeZpk(zeros, poles, gain)
  if (!zpk) return null
  const { zeros: zs, poles: ps, gain: k } = zpk
  const rs = residues(zs, ps, k)
  const time = makeTimes(tEnd ?? responseDuration(ps), numPoints)
  const value = time.map((t) => {
    let y = 0
    for (let i = 0; i < ps.length; i++) {
      const term = cmul(rs[i], cexp(cmul(fromPair(ps[i]), c(t, 0))))
      y += term.re
    }
    return y
  })
  return { time, value }
}

/**
 * @param {number} [tEnd] shared time horizon (seconds); defaults from this filter's poles
 * @returns {{ time: number[], value: number[] } | null}
 */
export function computeStep(zeros, poles, gain, numPoints = 5000, tEnd) {
  const zpk = sanitizeZpk(zeros, poles, gain)
  if (!zpk) return null
  const { zeros: zs, poles: ps, gain: k } = zpk
  const rs = residues(zs, ps, k)
  const h0 = evalH0(zs, ps, k)
  // Residue formula yields y(0⁺)=D for biproper systems via H(0)+Σ r_i/p_i.
  const time = makeTimes(tEnd ?? responseDuration(ps), numPoints)
  const value = time.map((t) => {
    let y = Number.isFinite(h0) ? h0 : 0
    for (let i = 0; i < ps.length; i++) {
      const p = fromPair(ps[i])
      if (p.re * p.re + p.im * p.im < 1e-24) continue
      const ai = cdiv(rs[i], p)
      const term = cmul(ai, cexp(cmul(p, c(t, 0))))
      y += term.re
    }
    return y
  })
  return { time, value }
}

/**
 * ZPK gain k for H(s)=k Π(s−z)/Π(s−p). Prefer BA leading-coefficient ratio
 * because filterResult.gain is only the design gain bookkeeping field.
 */
export function zpkGainFromBa(num, den) {
  if (!num?.length || !den?.length || !(Math.abs(den[0]) > 0)) return null
  const k = num[0] / den[0]
  return Number.isFinite(k) ? k : null
}

/** TeX axis labels (built in .js so Svelte never treats $y/$h/$t as stores). */
export const STEP_Y_LABEL = '$y(t)$'
export const IMPULSE_Y_LABEL = '$h(t)$'

/**
 * Pick one SI time unit for the whole plot so ticks don't mix (e.g. 0.0002 s vs 500 µs).
 * @returns {{ scale: number, unit: string, xLabel: string }}
 */
export function pickTimeUnit(tEndSeconds) {
  const t = Number.isFinite(tEndSeconds) && tEndSeconds > 0 ? tEndSeconds : 1
  // Concatenate so tooling/Svelte never sees a bare `$t` store token.
  const tVar = '$' + 't$'
  if (t >= 1) return { scale: 1, unit: 's', xLabel: `${tVar} [s]` }
  if (t >= 1e-3) return { scale: 1e3, unit: 'ms', xLabel: `${tVar} [ms]` }
  if (t >= 1e-6) return { scale: 1e6, unit: 'µs', xLabel: `${tVar} [µs]` }
  return { scale: 1e9, unit: 'ns', xLabel: `${tVar} [ns]` }
}

/** Scale a { time, value } response into the chosen unit. */
export function scaleTimeResponse(resp, scale) {
  if (!resp) return null
  return {
    time: resp.time.map(t => t * scale),
    value: resp.value,
  }
}
