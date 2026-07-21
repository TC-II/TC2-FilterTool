/**
 * Stable, engine-neutral contract at the Comlink worker boundary.
 *
 * Frequencies used by filterDesign are angular frequencies (rad/s). Bode
 * limits are ordinary frequencies (Hz).
 */

export type ComplexPair = readonly [real: number, imaginary: number]
export type FilterType = 0 | 1 | 2 | 3 | 4
export type ApproximationType = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type BandDefinition = 0 | 1
export type StageNormalization = 'Passband' | 'ω→0' | 'ω→∞' | 'ω→ω0'

export interface FilterDesignBase {
  filter_type: FilterType
  approx_type: ApproximationType
  N_min: number
  N_max: number
  ap_dB: number
  aa_dB: number
  gain: number
  normalization: StageNormalization
  is_helper: boolean
  helper_approx: ApproximationType[]
  helper_N: number
  define_with: BandDefinition
  name: string
  denorm: number
  gamma: number
  tau0: number
}

export interface LowOrHighPassDesignRequest extends FilterDesignBase {
  filter_type: 0 | 1
  wp: number
  wa: number
  w0: 0
  bw: [0, 0]
  wrg: 0
}

export interface BandDesignRequest extends FilterDesignBase {
  filter_type: 2 | 3
  wp: [number, number]
  wa: [number, number]
  w0: number
  bw: [number, number]
  wrg: 0
}

export interface GroupDelayDesignRequest extends FilterDesignBase {
  filter_type: 4
  wp: 0
  wa: 0
  w0: 0
  bw: [0, 0]
  wrg: number
}

export type FilterDesignRequest =
  | LowOrHighPassDesignRequest
  | BandDesignRequest
  | GroupDelayDesignRequest

/**
 * Validation failures from filterDesign are values, not rejected promises.
 * Other worker/runtime failures currently reject the Comlink promise. Future
 * engines must preserve this distinction until callers are migrated.
 */
export interface EngineError {
  error: string
}

export interface FilterDesignSuccess {
  zeros: ComplexPair[]
  poles: ComplexPair[]
  num: number[]
  den: number[]
  gain: number
  N: number
}

export type FilterDesignResponse = FilterDesignSuccess | EngineError

export interface BodeResponse {
  freq: number[]
  magnitude: number[]
  phase: number[]
  groupDelay: number[]
}

export interface StageResponse {
  num: number[]
  den: number[]
  gain: number
}

export type ProgressCallback = (percent: number, status: string) => void | Promise<void>

export interface EngineApi {
  init(baseUrl: string, onProgress?: ProgressCallback): Promise<true>
  filterDesign(params: FilterDesignRequest): Promise<FilterDesignResponse>
  computeBode(
    num: number[],
    den: number[],
    freqMinHz?: number,
    freqMaxHz?: number,
    numPoints?: number,
  ): Promise<BodeResponse>
  buildStageFromZPK(
    zeros: ComplexPair[],
    poles: ComplexPair[],
    gain: number,
    normtype?: StageNormalization,
    filterType?: FilterType,
  ): Promise<StageResponse>
}

export function isEngineError(
  response: FilterDesignResponse,
): response is EngineError {
  return 'error' in response
}
