import { wrap } from 'comlink'

/** @type {import('comlink').Remote<import('./engine-api').EngineApi> | null} */
let _api = null

/** @returns {import('comlink').Remote<import('./engine-api').EngineApi>} */
export function getWorkerApi() {
  if (!_api) {
    const worker = new Worker(
      new URL('../worker/wasm.worker.js', import.meta.url),
      { type: 'module' },
    )
    _api = wrap(worker)
  }
  return _api
}

// ── Killable design slots ────────────────────────────────────────────────────
// filterDesign is one synchronous wasm call: a Bessel design that runs up to
// order 50 can't be interrupted from inside its worker, and it blocks everything
// queued behind it. Heavy designs therefore run in their own workers ("slots",
// e.g. 'design' for the main filter, 'cmp:<approx>' per comparison) that are
// simply terminated when the request is no longer wanted.

export class DesignAborted extends Error {
  constructor() { super('Design aborted'); this.name = 'DesignAborted' }
}

/** @type {Map<string, { worker: Worker, api: any, ready: Promise<any>, dead: Promise<never>, kill: () => void, busy: number, since: number }>} */
const slots = new Map()

function spawn(slot) {
  const worker = new Worker(
    new URL('../worker/wasm.worker.js', import.meta.url),
    { type: 'module' },
  )
  const api = wrap(worker)
  let kill
  const dead = new Promise((_, reject) => { kill = () => reject(new DesignAborted()) })
  dead.catch(() => {})
  const ready = api.init()
  ready.catch(() => {})
  const entry = { worker, api, ready, dead, kill, busy: 0, since: 0 }
  slots.set(slot, entry)
  return entry
}

/**
 * Run `fn(api)` in the slot's own worker (started on first use). Rejects with
 * DesignAborted if the slot is aborted meanwhile.
 * @template T
 * @param {string} slot
 * @param {(api: import('comlink').Remote<import('./engine-api').EngineApi>) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runInSlot(slot, fn) {
  const entry = slots.get(slot) ?? spawn(slot)
  if (entry.busy++ === 0) entry.since = performance.now()
  const settle = () => { entry.busy-- }
  const p = Promise.race([entry.ready.then(() => fn(entry.api)), entry.dead])
  p.then(settle, settle)
  return p
}

/**
 * Kill the slot's worker if it is busy and has been for at least `minMs` (a
 * fast design is cheaper to let finish than to restart a worker for).
 * @returns {boolean} whether it was aborted
 */
export function abortSlot(slot, minMs = 0) {
  const entry = slots.get(slot)
  if (!entry || entry.busy === 0 || performance.now() - entry.since < minMs) return false
  slots.delete(slot)
  entry.worker.terminate()
  entry.kill()
  return true
}

/** A running design older than this is killed when it is superseded. */
export const ABORT_AFTER_MS = 300
