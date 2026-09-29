import { writable, derived } from 'svelte/store'
import { DEFAULT_FORM } from '../lib/params.js'

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

function persistedEnum(key, allowed, fallback) {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null
  const store = writable(allowed.includes(stored) ? stored : fallback)
  if (typeof window !== 'undefined') {
    store.subscribe(value => localStorage.setItem(key, value))
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
/** Plotly hover readout (crosshair + tooltip). Off by default. */
export const plotCursor  = persistedBool('filtertool.plotCursor', false)

/** Frequency units: 'hz' | 'rad'. Data = form entry + numeric readouts, plot = axes. */
export const FREQ_UNITS = ['hz', 'rad']
export const dataUnit = persistedEnum('filtertool.dataUnit', FREQ_UNITS, 'hz')
export const plotUnit = persistedEnum('filtertool.plotUnit', FREQ_UNITS, 'hz')

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
/** Game mode (quiz) is showing instead of the designer. */
export const gameMode = writable(false)

/** Live design form (FilterPanel; later the template handles). Frequencies in the data unit. */
export const designForm = writable({ ...DEFAULT_FORM })

/** Form fields whose template edge is hovered (form ↔ plot link), e.g. ['fp'] or ['fa', 'aaDb']. */
export const hoveredFields = writable([])

/** Stage under the pointer (stage card, stage curve or one of its roots): highlights it everywhere. */
export const hoveredStageId = writable(null)

/** Design action state (lib/design-action.js). */
export const designBusy  = writable(false)
export const designError = writable('')
/** True while a live control (denorm slider) is held: comparisons wait for release. */
export const liveAdjusting = writable(false)

/** True while a template handle is dragged (the release re-designs). */
export const templateDragging = writable(false)

/** E6: re-design automatically (debounced) whenever the form changes. */
export const liveMode = persistedBool('filtertool.liveMode', false)

/** One transient notice: { message, actionLabel?, onAction?, timeoutMs? } or null. */
export const toast = writable(null)

// Filter design: snapshot of the last successful design
export const filterParams = writable(null)
export const filterResult = writable(null)   // { zeros, poles, num, den, gain, N, roots: { zeros, poles } }
export const bodeData     = writable(null)   // { freq, magnitude, phase, groupDelay }

// Stages — each: { id, name, zeroIds, poleIds, zeros, poles, gain, num, den, normtype }
// zeroIds/poleIds reference filterResult.roots (lib/roots.js); zeros/poles hold [re, im].
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

// Derived: available (unassigned) roots, as root objects from filterResult.roots
export const remainingPZ = derived(
  [filterResult, stages],
  ([$fr, $stages]) => {
    if (!$fr?.roots) return { zeros: [], poles: [] }
    const used = new Set($stages.flatMap(s => [...(s.zeroIds ?? []), ...(s.poleIds ?? [])]))
    return {
      zeros: $fr.roots.zeros.filter(r => !used.has(r.id)),
      poles: $fr.roots.poles.filter(r => !used.has(r.id)),
    }
  }
)

export const uiEnabled = derived(
  [engineReady, engineError],
  ([$ready, $error]) => $ready && !$error
)
