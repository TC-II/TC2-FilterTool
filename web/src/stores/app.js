import { writable, derived } from 'svelte/store'

const preferredTheme = typeof window !== 'undefined'
  ? (localStorage.getItem('filtertool.theme')
      ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  : 'dark'

function persistedBool(key, fallback) {
  const initial = typeof window !== 'undefined'
    ? localStorage.getItem(key) ?? (fallback ? '1' : '0')
    : (fallback ? '1' : '0')
  const store = writable(initial !== '0')
  if (typeof window !== 'undefined') {
    store.subscribe(value => localStorage.setItem(key, value ? '1' : '0'))
  }
  return store
}

export const theme = writable(preferredTheme)

if (typeof window !== 'undefined') {
  theme.subscribe(value => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
    localStorage.setItem('filtertool.theme', value)
  })
}

// Plot display prefs (navbar)
export const compareDash = persistedBool('filtertool.compareDash', true)
export const showLegend  = persistedBool('filtertool.showLegend', true)

function loadColorMode() {
  if (typeof window === 'undefined') return 'default'
  const v = localStorage.getItem('filtertool.colorMode')
  if (v === 'default' || v === 'gray' || v === 'random') return v
  // migrate old boolean
  if (localStorage.getItem('filtertool.mixColors') === '0') return 'gray'
  return 'default'
}

export const colorMode = writable(loadColorMode())
/** Palette-index remap for random mode: shuffle[approxType] → palette index */
export const colorShuffle = writable(
  typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('filtertool.colorShuffle') || 'null')
      ?? Array.from({ length: 7 }, (_, i) => i)
    : Array.from({ length: 7 }, (_, i) => i)
)

if (typeof window !== 'undefined') {
  colorMode.subscribe(value => localStorage.setItem('filtertool.colorMode', value))
  colorShuffle.subscribe(value => localStorage.setItem('filtertool.colorShuffle', JSON.stringify(value)))
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

/** Approximation indices selected in the Compare panel (excludes main). */
export const compareApproxes = writable([])
/** When true, comparisons use the main filter's order N. */
export const compareSameN = writable(false)

/**
 * One-shot form hydration for FilterPanel after Load.
 * Set to a filterParams object; the panel applies it and clears the store.
 */
export const pendingFormHydration = writable(null)

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
