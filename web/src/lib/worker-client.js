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
