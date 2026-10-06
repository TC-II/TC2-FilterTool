// The Design action, shared by the Design button, template-drag release and the
// live denorm slider. Latest-wins: a call made while a design is in flight is
// coalesced, and only the newest request runs next.
//
// Stages survive a redesign when they can: they're remapped onto the new
// design's roots and rebuilt with their own normalization. When they can't
// (other type / approximation / order, or REMAP_STAGES off) they're cleared
// with an "Undo" toast that restores the previous design, form and stages.

import { get, writable } from 'svelte/store'
import { TWO_PI, freqRangeFromParams } from './approx.js'
import { buildParams, formFromParams, validateForm, paramsClose } from './params.js'
import { withRoots } from './roots.js'
import { remapStages } from './stage-remap.js'
import { buildStage, rootsModified } from './stages.js'
import { getWorkerApi } from './worker-client.js'
import { designBode } from './zpk-bode.js'
import { table, fmt } from './i18n.js'
import {
  lang, designForm, dataUnit, bodePoints, filterParams, filterResult, bodeData, stages,
  engineStatus, designBusy, designError, toast, liveAdjusting, templateDragging, activeTab, engineReady,
} from '../stores/app.js'

/**
 * Q2: remap stages onto the new roots after a redesign. Set false to fall back
 * to clearing them (with Undo) if remapping ever costs too much while dragging.
 */
export const REMAP_STAGES = true

let running = false
/** @type {null | { params?: object }} newest request waiting for the in-flight one */
let pending = null

/**
 * Design and publish. With `params`, design exactly those (live denorm);
 * otherwise from the current $designForm.
 * @param {{ params?: object }} [request]
 * @returns {Promise<boolean>} true when the (last) run published a design
 */
export async function runDesign(request = {}) {
  if (running) { pending = request; return false }
  running = true
  let ok = false
  try {
    let next = request
    while (next) {
      pending = null
      ok = await designOnce(next)
      next = pending
    }
  } finally {
    running = false
  }
  return ok
}

/**
 * Live denorm (slider or curve drag): re-design the last designed params with
 * only denorm changed, so pending form edits stay pending. Comparisons wait
 * for end() (liveAdjusting).
 *
 * On the Template / Magnitude tabs it runs in preview mode: each step only
 * asks the engine for the new poles / zeros (no Bode, no store publish) and
 * publishes them on `denormPreview`, which the tab evaluates and draws on a
 * canvas; end() then designs once for real. Elsewhere every step re-designs.
 */
export const denormPreview = writable(null)   // { result, params } | null
const PREVIEW_TABS = new Set(['template', 'magnitude'])

let liveBase = null
let previewMode = false
let previewSession = 0
let lastDenorm = null
let previewBusy = false, previewNext = null

async function previewDesign(params, session) {
  if (previewBusy) { previewNext = params; return }
  previewBusy = true
  try {
    let p = params
    while (p) {
      previewNext = null
      const r = await getWorkerApi().filterDesign(p)
      if (session !== previewSession) return
      if (!r.error) denormPreview.set({ result: r, params: p })
      p = previewNext
    }
  } finally {
    previewBusy = false
  }
}

export const liveDenorm = {
  /** @returns {boolean} false when there's no design to adjust */
  start() {
    if (liveBase) return true
    const p = get(filterParams)
    if (!p) return false
    liveBase = p
    lastDenorm = p.denorm ?? 0
    previewMode = PREVIEW_TABS.has(get(activeTab))
    previewSession++
    liveAdjusting.set(true)
    return true
  },
  update(denorm) {
    if (!liveBase) return
    lastDenorm = denorm
    designForm.update(f => (f.denorm === denorm ? f : { ...f, denorm }))
    if (previewMode) previewDesign({ ...liveBase, denorm }, previewSession)
    else runDesign({ params: { ...liveBase, denorm } })
  },
  end() {
    const base = liveBase, wasPreview = previewMode
    liveBase = null
    previewMode = false
    liveAdjusting.set(false)
    if (!wasPreview) return
    const session = ++previewSession        // late preview results are dropped
    if (!base || lastDenorm === (base.denorm ?? 0)) { denormPreview.set(null); return }
    // One real design; the preview stays until it's published (the tab clears
    // its canvas once Plotly has drawn the new curve).
    runDesign({ params: { ...base, denorm: lastDenorm } }).finally(() => {
      if (session === previewSession) denormPreview.set(null)
    })
  },
  /** Params the live session started from (null when idle). */
  get base() { return liveBase },
}

const TX = {
  en: {
    stagesFollow: 'Stages follow the new design: moved poles / zeros were reset.',
    stageCleared: '{n} stage cleared: the new design\'s poles and zeros don\'t match the old ones.',
    stagesCleared: '{n} stages cleared: the new design\'s poles and zeros don\'t match the old ones.',
    undo: 'Undo',
  },
  es: {
    stagesFollow: 'Las etapas siguen al nuevo diseño: se restablecieron los polos / ceros movidos.',
    stageCleared: 'Se borró {n} etapa: los polos y ceros del nuevo diseño no coinciden con los anteriores.',
    stagesCleared: 'Se borraron {n} etapas: los polos y ceros del nuevo diseño no coinciden con los anteriores.',
    undo: 'Deshacer',
  },
}
const txNow = () => table(TX, get(lang))

const toRadNow = () => (get(dataUnit) === 'rad' ? 1 : TWO_PI)

async function designOnce({ params: given } = {}) {
  let params = given
  if (!params) {
    const form = get(designForm)
    const errs = Object.values(validateForm(form, get(lang)))
    if (errs.length) { designError.set(errs[0]); return false }
    params = buildParams(form, toRadNow())
  }

  designBusy.set(true)
  designError.set('')
  engineStatus.set('Computing…')
  try {
    const api = getWorkerApi()
    const raw = await api.filterDesign(params)
    if (raw.error) { designError.set(raw.error.split('\n').at(-2) ?? raw.error); return false }
    const result = withRoots(raw)
    const r      = freqRangeFromParams(params)
    const bode   = await designBode(api, result, r.min, r.max, get(bodePoints))
    const prev   = { params: get(filterParams), result: get(filterResult), bode: get(bodeData), stages: get(stages) }
    const carried = await carryStages(api, prev, params, result)

    // Publish together so plots never pair a new design with an old Bode / stages.
    stages.set(carried)
    filterParams.set(params)
    filterResult.set(result)
    bodeData.set(bode)
    return true
  } catch (e) {
    designError.set(e?.message ?? String(e))
    return false
  } finally {
    designBusy.set(false)
    engineStatus.set('Ready')
  }
}

async function carryStages(api, prev, params, result) {
  if (!prev.stages.length) return []
  if (REMAP_STAGES && prev.result?.roots && prev.params
      && prev.params.filter_type === params.filter_type
      && prev.params.approx_type === params.approx_type) {
    const moved = remapStages(prev.stages, prev.result.roots, result.roots)
    if (moved) {
      // Roots follow the new design (user root edits are dropped); normalization
      // and gain offset carry over. orig = the stage as it now stands on the new design.
      const hadRootEdits = prev.stages.some(rootsModified)
      const rebuilt = await Promise.all(moved.map(async s => {
        const next = {
          ...s,
          orig: { zeros: s.zeros, poles: s.poles, normtype: s.orig?.normtype ?? s.normtype, gainDb: s.orig?.gainDb ?? 0 },
        }
        try { return await buildStage(api, next, params.filter_type) } catch { return null }
      }))
      if (rebuilt.every(Boolean)) {
        if (hadRootEdits) toast.set({ message: txNow().stagesFollow, timeoutMs: 6000 })
        return rebuilt
      }
    }
  }
  offerUndo(prev)
  return []
}

function offerUndo(prev) {
  const n = prev.stages.length
  const tx = txNow()
  toast.set({
    message: fmt(n === 1 ? tx.stageCleared : tx.stagesCleared, { n }),
    actionLabel: tx.undo,
    timeoutMs: 10000,
    onAction: () => {
      designForm.update(f => formFromParams(prev.params, toRadNow(), f))
      filterParams.set(prev.params)
      filterResult.set(prev.result)
      bodeData.set(prev.bode)
      stages.set(prev.stages)
    },
  })
}

// ── Live updates ─────────────────────────────────────────────────────────────
// There is no Design button: any form change re-designs after a short pause
// (and the first design runs as soon as the engine is ready). Denorm
// (liveDenorm) and template drags (re-design on release) handle themselves.
const LIVE_DEBOUNCE_MS = 200
let liveTimer = null

function liveTick() {
  liveTimer = null
  if (!get(engineReady) || get(liveAdjusting) || get(templateDragging)) return
  const form = get(designForm)
  if (Object.keys(validateForm(form)).length) return
  const current = get(filterParams)
  if (current && paramsClose(buildParams(form, toRadNow()), current)) return
  runDesign()
}

/** Start watching the form (and the engine coming up); returns an unsubscribe function. */
export function startLiveMode() {
  const schedule = () => {
    clearTimeout(liveTimer)
    liveTimer = setTimeout(liveTick, LIVE_DEBOUNCE_MS)
  }
  const unsubs = [designForm.subscribe(schedule), engineReady.subscribe(schedule), templateDragging.subscribe(schedule)]
  return () => { clearTimeout(liveTimer); unsubs.forEach(u => u()) }
}
