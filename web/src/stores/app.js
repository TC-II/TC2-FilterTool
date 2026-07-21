import { writable, derived } from 'svelte/store'

const preferredTheme = typeof window !== 'undefined'
  ? (localStorage.getItem('filtertool.theme')
      ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  : 'dark'

export const theme = writable(preferredTheme)

if (typeof window !== 'undefined') {
  theme.subscribe(value => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
    localStorage.setItem('filtertool.theme', value)
  })
}

// Runtime state
export const engineReady    = writable(false)
export const engineError    = writable(null)
export const engineStatus   = writable('Loading WASM filter engine…')
export const engineProgress = writable(0)    // 0–100

// Active UI state
export const activeTab = writable('template')
export const sidebarOpen = writable(true)

// Filter design
export const filterParams = writable(null)
export const filterResult = writable(null)   // { zeros, poles, num, den, gain, N }
export const bodeData     = writable(null)   // { freq, magnitude, phase, groupDelay }

// Stages — each: { id, name, zeros, poles, gain, num, den, bode? }
export const stages = writable([])

// Datalines (imported datasets + filter TFs) — Phase 7
export const datalines = writable([])

// Comparison filters: [{ approxType, filterResult, bodeData }]
export const comparisons = writable([])

// Number of frequency points used for all Bode computations
export const bodePoints = writable(2000)

// Derived: available (unassigned) poles and zeros
export const remainingPZ = derived(
  [filterResult, stages],
  ([$fr, $stages]) => {
    if (!$fr) return { zeros: [], poles: [] }
    const usedZeros = new Set($stages.flatMap(s => s.zeros.map(pzKey)))
    const usedPoles = new Set($stages.flatMap(s => s.poles.map(pzKey)))
    return {
      zeros: $fr.zeros.filter(z => !usedZeros.has(pzKey(z))),
      poles: $fr.poles.filter(p => !usedPoles.has(pzKey(p))),
    }
  }
)

export const uiEnabled = derived(
  [engineReady, engineError],
  ([$ready, $error]) => $ready && !$error
)

// Stable key for a pole or zero [real, imag]
export function pzKey([r, i]) {
  return `${r.toFixed(10)},${i.toFixed(10)}`
}
