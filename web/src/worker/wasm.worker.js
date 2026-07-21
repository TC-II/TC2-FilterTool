import { expose } from 'comlink'
import initWasm, {
  buildStageFromZPK as wasmBuildStageFromZPK,
  computeBode as wasmComputeBode,
  filterDesign as wasmFilterDesign,
} from '@filter-engine/filter_engine.js'

let initPromise = null

function requireInitialized() {
  if (!initPromise) {
    throw new Error('WASM filter engine has not been initialized')
  }
}

/** @satisfies {import('../lib/engine-api').EngineApi} */
const api = {
  async init(_baseUrl, onProgress) {
    const report = (pct, status) => {
      if (onProgress) onProgress(pct, status)
    }

    if (!initPromise) {
      report(10, 'Loading WASM filter engine…')
      initPromise = initWasm().catch((error) => {
        initPromise = null
        throw error
      })
    }

    await initPromise
    report(100, 'WASM filter engine ready')
    return /** @type {const} */ (true)
  },

  async filterDesign(params) {
    requireInitialized()
    await initPromise
    return wasmFilterDesign(params)
  },

  async computeBode(
    num,
    den,
    freqMinHz = 0.1,
    freqMaxHz = 1e5,
    numPoints = 2000,
  ) {
    requireInitialized()
    await initPromise
    return wasmComputeBode(
      new Float64Array(num),
      new Float64Array(den),
      freqMinHz,
      freqMaxHz,
      numPoints,
    )
  },

  async buildStageFromZPK(
    zeros,
    poles,
    gain,
    normtype = 'Passband',
    filterType = 0,
  ) {
    requireInitialized()
    await initPromise
    return wasmBuildStageFromZPK(
      zeros,
      poles,
      gain,
      normtype,
      filterType,
    )
  },
}

expose(api)
