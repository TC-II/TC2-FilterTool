import { wrap } from 'comlink'

let _api = null

export function getWorkerApi() {
  if (!_api) {
    const worker = new Worker(
      new URL('../worker/pyodide.worker.js', import.meta.url),
      { type: 'module' }
    )
    _api = wrap(worker)
  }
  return _api
}
