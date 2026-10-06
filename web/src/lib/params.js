// Pure helpers for the design form: form ↔ engine params, band edges, validation.
//
// Form frequencies are held in the current data unit (Hz or rad/s); `toRad` is
// the factor that converts one form unit to rad/s (2π for Hz, 1 for rad/s).
// Engine params are always rad/s.

import { table, fmt } from './i18n.js'

export const LP = 0, HP = 1, BP = 2, BR = 3, GD = 4
export const FREQS = 0, F0_BW = 1          // define_with
export const MAX_ORDER = 50                // engine MAX_ORDER
export const GD_APPROX = new Set([5, 6])   // group delay: Bessel, Gauss only
export const MAG_APPROX = new Set([0, 1, 2, 3, 4])   // HP / BP / BR: no Bessel / Gauss

/**
 * Approximations a filter type supports (null = all of them). Bessel and Gauss
 * are group-delay approximations: they are offered for LP (as a magnitude
 * reference) and GD only, not transformed to HP / BP / BR.
 */
export function allowedApprox(filterType) {
  if (filterType === GD) return GD_APPROX
  if (filterType === HP || filterType === BP || filterType === BR) return MAG_APPROX
  return null
}

/** Fallback approximation when switching to a type that doesn't support the current one. */
export const defaultApprox = filterType => (filterType === GD ? 5 : 0)

/** Defaults, frequencies in Hz. */
export const DEFAULT_FORM = {
  filterType: LP, approxType: 0,
  // The designer always searches the whole range (no order control): the
  // engine returns the minimum order that meets the template, capped at 50.
  nMin: 1, nMax: MAX_ORDER,
  apDb: 3, aaDb: 40, gainDb: 0,
  denorm: 0,                               // 0–100 %
  // LP / HP
  fp: 1000, fa: 2000,
  // BP / BR: bwp is always the passband width, bwa the stopband width
  defineWith: F0_BW,
  f0: 1000, bwp: 200, bwa: 600,
  fp1: 800, fp2: 1200, fa1: 600, fa2: 1500,
  // Group delay
  tau0: 1e-3, frg: 1000, gamma: 5,
}

export const FREQ_FIELDS = ['fp', 'fa', 'f0', 'bwp', 'bwa', 'fp1', 'fp2', 'fa1', 'fa2', 'frg']

export const isBand = ft => ft === BP || ft === BR

/**
 * Geometrically symmetric band edges around f0 with arithmetic width bw
 * (lo·hi = f0², hi − lo = bw), as in Filter.py validate() F0_BW for both BP
 * (w0·(√(1+1/4Q²) ∓ 1/2Q)) and BR (½(−bw+√(bw²+4w0²))). Unit-agnostic.
 */
export function bandEdges(f0, bw) {
  const lo = Math.sqrt(f0 * f0 + bw * bw / 4) - bw / 2
  return [lo, lo + bw]
}

/** Multiply every frequency field by k (unit flip keeps the physical values). */
export function rescaleForm(form, k) {
  const f = { ...form }
  for (const key of FREQ_FIELDS) f[key] = form[key] * k
  return f
}

/** Design form → engine params (rad/s). */
export function buildParams(form, toRad) {
  const r = v => v * toRad
  const ft = form.filterType
  const base = {
    filter_type: ft, approx_type: form.approxType,
    N_min: form.nMin, N_max: form.nMax,
    ap_dB: form.apDb, aa_dB: form.aaDb,
    gain: Math.pow(10, form.gainDb / 20),
    normalization: 'Passband',
    is_helper: false, helper_approx: [], helper_N: -1,
    define_with: form.defineWith, denorm: form.denorm,
    gamma: form.gamma, tau0: form.tau0,
  }
  if (ft === GD) return { ...base, wrg: r(form.frg), wp: 0, wa: 0, w0: 0, bw: [0, 0] }
  if (!isBand(ft)) return { ...base, wp: r(form.fp), wa: r(form.fa), w0: 0, bw: [0, 0], wrg: 0 }

  if (form.defineWith === F0_BW) {
    // wp/wa only feed the template: the engine designs from w0 + bw.
    // bw[0] is the inner band: passband for BP, stopband for BR.
    return {
      ...base,
      wp: bandEdges(form.f0, form.bwp).map(r),
      wa: bandEdges(form.f0, form.bwa).map(r),
      w0: r(form.f0),
      bw: ft === BP ? [r(form.bwp), r(form.bwa)] : [r(form.bwa), r(form.bwp)],
      wrg: 0,
    }
  }
  // Frequencies: the engine derives w0 / bw from the inner edges itself.
  const [i0, i1] = ft === BP ? [form.fp1, form.fp2] : [form.fa1, form.fa2]
  const [o0, o1] = ft === BP ? [form.fa1, form.fa2] : [form.fp1, form.fp2]
  return {
    ...base,
    wp: [r(form.fp1), r(form.fp2)], wa: [r(form.fa1), r(form.fa2)],
    w0: r(Math.sqrt(i0 * i1)), bw: [r(i1 - i0), r(o1 - o0)], wrg: 0,
  }
}

/**
 * Engine params → form (inverse of buildParams), keeping `prev` for fields the
 * params don't carry. `toRad` as in buildParams.
 */
export function formFromParams(p, toRad, prev = DEFAULT_FORM) {
  const u = w => Number(w) / toRad
  const or = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback)
  const f = {
    ...prev,
    filterType: p.filter_type ?? 0,
    approxType: p.approx_type ?? 0,
    // Always the full range, whatever a loaded file says
    nMin: 1,
    nMax: MAX_ORDER,
    apDb: p.ap_dB ?? 3,
    aaDb: p.aa_dB ?? 40,
    gainDb: 20 * Math.log10(Math.max(p.gain ?? 1, 1e-12)),
    denorm: p.denorm ?? 0,
    defineWith: p.define_with ?? F0_BW,
    gamma: p.gamma ?? 5,
    tau0: p.tau0 ?? 1e-3,
  }
  const ft = f.filterType
  if (ft === GD) return { ...f, frg: or(u(p.wrg), prev.frg) }
  if (!isBand(ft)) return { ...f, fp: or(u(p.wp), prev.fp), fa: or(u(p.wa), prev.fa) }
  if (f.defineWith === F0_BW) {
    const [inner, outer] = [u(p.bw?.[0]), u(p.bw?.[1])]
    return {
      ...f,
      f0: or(u(p.w0), prev.f0),
      bwp: or(ft === BP ? inner : outer, prev.bwp),
      bwa: or(ft === BP ? outer : inner, prev.bwa),
    }
  }
  return {
    ...f,
    fp1: or(u(p.wp?.[0]), prev.fp1), fp2: or(u(p.wp?.[1]), prev.fp2),
    fa1: or(u(p.wa?.[0]), prev.fa1), fa2: or(u(p.wa?.[1]), prev.fa2),
  }
}

const VALIDATE_TX = {
  en: {
    positive: '{label} must be > 0',
    nMin: 'N min must be an integer ≥ 1',
    nMax: 'N max must be an integer ≤ {max}',
    nOrder: 'N max must be ≥ N min',
    ripple: 'Ripple must be > 0 dB',
    atten: 'Attenuation must be larger than the ripple',
    gdApprox: 'Group delay supports only Bessel and Gauss',
    magApprox: 'Bessel and Gauss are available only for low-pass and group delay',
    refFreq: 'Reference frequency',
    gamma: 'γ must be between 0 and 100 %',
    fp: 'Passband edge',
    fa: 'Stopband edge',
    lpOrder: 'Low-pass needs passband edge < stopband edge',
    hpOrder: 'High-pass needs stopband edge < passband edge',
    f0: 'Centre frequency',
    bwp: 'BWp',
    bwa: 'BWa',
    bpBw: 'Band-pass needs BWp < BWa',
    brBw: 'Band-reject needs BWa (stop) < BWp (pass)',
    edges: 'Band edges',
    bpEdges: 'Band-pass needs a₁ < p₁ < p₂ < a₂',
    brEdges: 'Band-reject needs p₁ < a₁ < a₂ < p₂',
  },
  es: {
    positive: '{label} debe ser > 0',
    nMin: 'N mín. debe ser un entero ≥ 1',
    nMax: 'N máx. debe ser un entero ≤ {max}',
    nOrder: 'N máx. debe ser ≥ N mín.',
    ripple: 'Ap debe ser > 0 dB',
    atten: 'Aa debe ser mayor que Ap',
    gdApprox: 'El retardo de grupo solo admite Bessel y Gauss',
    magApprox: 'Bessel y Gauss solo están disponibles para pasa-bajos y retardo de grupo',
    refFreq: 'La frecuencia de referencia',
    gamma: 'γ debe estar entre 0 y 100 %',
    fp: 'La frecuencia de paso',
    fa: 'La frecuencia de atenuación',
    lpOrder: 'Un pasa-bajos requiere fp < fa',
    hpOrder: 'Un pasa-altos requiere fa < fp',
    f0: 'La frecuencia central',
    bwp: 'Bp',
    bwa: 'Ba',
    bpBw: 'Un pasa-banda requiere Bp < Ba',
    brBw: 'Un rechaza-banda requiere Ba (atenuación) < Bp (paso)',
    edges: 'Los bordes de banda',
    bpEdges: 'Un pasa-banda requiere a₁ < p₁ < p₂ < a₂',
    brEdges: 'Un rechaza-banda requiere p₁ < a₁ < a₂ < p₂',
  },
}

/**
 * Human-readable validation mirroring the engine's validate().
 * Returns { field: message }, empty when valid. Field names match the form.
 * `lang` picks the message language ('en' | 'es').
 */
export function validateForm(form, lang = 'en') {
  const tx = table(VALIDATE_TX, lang)
  const e = {}
  const ft = form.filterType
  const pos = (k, label) => { if (!(form[k] > 0)) e[k] = fmt(tx.positive, { label }) }

  if (!Number.isInteger(form.nMin) || form.nMin < 1) e.nMin = tx.nMin
  if (!Number.isInteger(form.nMax) || form.nMax > MAX_ORDER) e.nMax = fmt(tx.nMax, { max: MAX_ORDER })
  if (!e.nMin && !e.nMax && form.nMin > form.nMax) e.nMax = tx.nOrder

  if (!(form.apDb > 0)) e.apDb = tx.ripple
  else if (!(form.aaDb > form.apDb)) e.aaDb = tx.atten

  const allow = allowedApprox(ft)
  if (allow && !allow.has(form.approxType)) e.approxType = ft === GD ? tx.gdApprox : tx.magApprox

  if (ft === GD) {
    pos('tau0', 'τ₀'); pos('frg', tx.refFreq)
    if (!(form.gamma > 0 && form.gamma < 100)) e.gamma = tx.gamma
    return e
  }

  if (!isBand(ft)) {
    pos('fp', tx.fp); pos('fa', tx.fa)
    if (!e.fp && !e.fa) {
      if (ft === LP && !(form.fp < form.fa)) e.fa = tx.lpOrder
      if (ft === HP && !(form.fa < form.fp)) e.fa = tx.hpOrder
    }
    return e
  }

  if (form.defineWith === F0_BW) {
    pos('f0', tx.f0); pos('bwp', tx.bwp); pos('bwa', tx.bwa)
    if (!e.bwp && !e.bwa) {
      if (ft === BP && !(form.bwp < form.bwa)) e.bwa = tx.bpBw
      if (ft === BR && !(form.bwa < form.bwp)) e.bwp = tx.brBw
    }
    return e
  }

  for (const k of ['fp1', 'fp2', 'fa1', 'fa2']) pos(k, tx.edges)
  if (e.fp1 || e.fp2 || e.fa1 || e.fa2) return e
  const { fp1, fp2, fa1, fa2 } = form
  if (ft === BP && !(fa1 < fp1 && fp1 < fp2 && fp2 < fa2)) e.fa2 = tx.bpEdges
  if (ft === BR && !(fp1 < fa1 && fa1 < fa2 && fa2 < fp2)) e.fa2 = tx.brEdges
  return e
}

/**
 * Change filter type, swapping pass/stop values when they're oriented for the
 * other response, so the current numbers stay a valid template whatever the
 * previous type was (LP↔HP: fp/fa; BP↔BR: widths and band edges).
 */
export function switchFilterType(form, ft) {
  const f = { ...form, filterType: ft }
  if ((ft === LP && f.fp > f.fa) || (ft === HP && f.fp < f.fa)) {
    [f.fp, f.fa] = [f.fa, f.fp]
  }
  if ((ft === BP && f.bwp > f.bwa) || (ft === BR && f.bwp < f.bwa)) {
    [f.bwp, f.bwa] = [f.bwa, f.bwp]
  }
  // BP: a₁ < p₁ < p₂ < a₂ ; BR: p₁ < a₁ < a₂ < p₂
  const bpOrder = f.fa1 < f.fp1 && f.fp2 < f.fa2
  const brOrder = f.fp1 < f.fa1 && f.fa2 < f.fp2
  if ((ft === BP && brOrder) || (ft === BR && bpOrder)) {
    [f.fp1, f.fa1] = [f.fa1, f.fp1]
    ;[f.fp2, f.fa2] = [f.fa2, f.fp2]
  }
  return f
}

/** Deep equality of two params objects, numbers compared with a relative tolerance. */
export function paramsClose(a, b, rel = 1e-9) {
  if (typeof a === 'number' && typeof b === 'number')
    return a === b || Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b))
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => paramsClose(v, b[i], rel))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every(k => paramsClose(a[k], b[k], rel))
  }
  return a === b
}
