/**
 * Save / load FilterTool designs as JSON (.ftjson).
 * Results (TF, Bode, comparisons) are recomputed after load — only inputs are stored.
 */

import { freqRangeFromParams } from './approx.js'
import { withRoots } from './roots.js'
import { designBode } from './zpk-bode.js'
import { makeStage, buildStage } from './stages.js'
import { get } from 'svelte/store'
import { lang } from '../stores/app.js'
import { table, fmt } from './i18n.js'

const TX = {
  en: {
    nothing: 'Nothing to save — design a filter first.',
    invalid: 'Invalid design file.',
    version: 'Unsupported design file version ({v}).',
    noParams: 'Design file is missing filter parameters.',
    badType: 'Design file has an invalid filter type.',
    badApprox: 'Design file has an invalid approximation type.',
    noFile: 'No file selected.',
  },
  es: {
    nothing: 'No hay nada para guardar: primero diseñe un filtro.',
    invalid: 'Archivo de diseño inválido.',
    version: 'Versión de archivo de diseño no soportada ({v}).',
    noParams: 'Al archivo de diseño le faltan los parámetros del filtro.',
    badType: 'El archivo de diseño tiene un tipo de filtro inválido.',
    badApprox: 'El archivo de diseño tiene un tipo de aproximación inválido.',
    noFile: 'No se seleccionó ningún archivo.',
  },
}
const txNow = () => table(TX, get(lang))

/** Error thrown by pickDesignFile() when the picker is dismissed (not a real error). */
export const NO_FILE = 'no-file'

export const DESIGN_FILE_VERSION = 1
export const DESIGN_FILE_EXT = '.ftjson'
export const DESIGN_MIME = 'application/json'

/**
 * @param {{
 *   filterParams: object,
 *   stages?: object[],
 *   compareApproxes?: Iterable<number>,
 *   compareSameN?: boolean,
 *   bodePoints?: number,
 * }} state
 */
export function serializeDesign(state) {
  const params = state.filterParams
  if (!params) throw new Error(txNow().nothing)

  return {
    version: DESIGN_FILE_VERSION,
    app: 'FilterTool',
    filterParams: params,
    stages: (state.stages ?? []).map(s => ({
      id: s.id,
      name: s.name,
      zeros: s.zeros,
      poles: s.poles,
      normtype: s.normtype,
      gainDb: s.gainDb ?? 0,
      orig: s.orig,
      colorIndex: s.colorIndex ?? null,
      gain: s.gain,
      num: s.num,
      den: s.den,
    })),
    compare: {
      approxTypes: [...(state.compareApproxes ?? [])]
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 6),
      useMainN: Boolean(state.compareSameN),
    },
    bodePoints: Number(state.bodePoints) || 2000,
  }
}

/** @param {unknown} raw */
export function parseDesign(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!doc || typeof doc !== 'object') throw new Error(txNow().invalid)
  if (doc.version !== DESIGN_FILE_VERSION) {
    throw new Error(fmt(txNow().version, { v: doc.version ?? '?' }))
  }
  if (!doc.filterParams || typeof doc.filterParams !== 'object') {
    throw new Error(txNow().noParams)
  }
  const ft = doc.filterParams.filter_type
  const at = doc.filterParams.approx_type
  if (!Number.isInteger(ft) || ft < 0 || ft > 4) {
    throw new Error(txNow().badType)
  }
  if (!Number.isInteger(at) || at < 0 || at > 6) {
    throw new Error(txNow().badApprox)
  }

  const stages = Array.isArray(doc.stages) ? doc.stages : []
  const compare = doc.compare && typeof doc.compare === 'object' ? doc.compare : {}
  const approxTypes = Array.isArray(compare.approxTypes)
    ? compare.approxTypes.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6 && n !== at)
    : []

  return {
    filterParams: doc.filterParams,
    stages,
    compareApproxes: approxTypes,
    compareSameN: Boolean(compare.useMainN),
    bodePoints: Number(doc.bodePoints) || 2000,
  }
}

/** Trigger a browser download of the design JSON. */
export function downloadDesign(doc, filename = 'filtertool-design') {
  const json = JSON.stringify(doc, null, 2)
  const blob = new Blob([json], { type: DESIGN_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith(DESIGN_FILE_EXT) ? filename : `${filename}${DESIGN_FILE_EXT}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Open a file picker and return parsed design contents. */
export function pickDesignFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `${DESIGN_FILE_EXT},.json,application/json`
    input.style.display = 'none'

    const noFile = () => Object.assign(new Error(txNow().noFile), { code: NO_FILE })
    const finish = (err, value) => {
      input.remove()
      if (err) reject(err)
      else resolve(value)
    }

    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) {
        finish(noFile())
        return
      }
      try {
        const text = await file.text()
        finish(null, { doc: parseDesign(text), name: file.name })
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)))
      }
    })
    input.addEventListener('cancel', () => finish(noFile()))

    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Apply a parsed design: redesign TF + Bode, restore stages / comparisons.
 * @param {ReturnType<typeof parseDesign>} design
 * @param {import('./engine-api').EngineApi} api
 * @param {(status: string) => void} [onStatus]
 */
export async function materializeDesign(design, api, onStatus) {
  onStatus?.('Loading design…')   // stored in English; LoadingBadge translates
  const params = design.filterParams
  const raw = await api.filterDesign(params)
  if (raw.error) throw new Error(raw.error.split('\n').at(-2) ?? raw.error)
  const result = withRoots(raw)

  const range = freqRangeFromParams(params)
  const pts = design.bodePoints
  onStatus?.('Computing Bode…')
  const bode = await designBode(api, result, range.min, range.max, pts)

  // Re-attach saved stages to the redesigned roots. Each saved value claims one
  // unused root (repeated roots stay distinct); values that no longer exist are dropped.
  const usedIds = new Set()
  const claim = (roots, values) => {
    const out = []
    for (const v of values ?? []) {
      const root = matchRoot(roots, v, usedIds)
      if (!root) continue
      usedIds.add(root.id)
      out.push(root)
    }
    return out
  }
  const stages = []
  for (const s of design.stages) {
    // Match on the roots as built (moved roots keep their saved position).
    const moved = Array.isArray(s.orig?.zeros) && Array.isArray(s.orig?.poles)
    const zeros = claim(result.roots.zeros, moved ? s.orig.zeros : s.zeros)
    const poles = claim(result.roots.poles, moved ? s.orig.poles : s.poles)
    if (!poles.length && !zeros.length) continue
    const complete = zeros.length === (s.zeros ?? []).length && poles.length === (s.poles ?? []).length
    const designed = { zeros: zeros.map(r => [r.re, r.im]), poles: poles.map(r => [r.re, r.im]) }
    stages.push(makeStage({
      id: s.id ?? Date.now() + stages.length,
      name: s.name || `Stage ${stages.length + 1}`,
      zeroIds: zeros.map(r => r.id), poleIds: poles.map(r => r.id),
      ...(moved && complete ? { zeros: s.zeros, poles: s.poles } : designed),
      normtype: s.normtype ?? 'Passband',
      gainDb: Number(s.gainDb) || 0,
      colorIndex: Number.isInteger(s.colorIndex) ? s.colorIndex : null,
      orig: { ...designed, normtype: s.orig?.normtype ?? s.normtype ?? 'Passband', gainDb: Number(s.orig?.gainDb) || 0 },
    }))
  }
  // num / den from the engine, so they always match the stage values.
  for (let i = 0; i < stages.length; i++) stages[i] = await buildStage(api, stages[i], params.filter_type)

  return {
    filterParams: params,
    filterResult: result,
    bodeData: bode,
    stages,
    compareApproxes: design.compareApproxes.filter(a => a !== params.approx_type),
    compareSameN: design.compareSameN,
    bodePoints: pts,
  }
}

/** Nearest unused root to [re, im], within a relative tolerance. */
function matchRoot(roots, [re, im], usedIds) {
  let best = null, bestD = Infinity
  for (const r of roots) {
    if (usedIds.has(r.id)) continue
    const d = Math.hypot(r.re - Number(re), r.im - Number(im))
    if (d < bestD) { bestD = d; best = r }
  }
  const tol = 1e-7 * Math.max(1, Math.hypot(Number(re), Number(im)))
  return best && bestD <= tol ? best : null
}
