// Languages and shared vocabulary (pure: no Svelte, so node code like the
// game's quiz.js can use it too).
//
// Spanish follows the course material (TC2, Guía 3 "Funciones de aproximación,
// síntesis de filtros"): plantilla, banda de paso / de atenuación / de
// transición, pasa-bajos / pasa-altos / pasa-banda / rechaza-banda, Óptimo L,
// constelación de polos y ceros (PZ map), módulo y fase de la respuesta en
// frecuencia, respuesta al escalón, retardo de grupo, ceros de transmisión,
// orden, orden mínimo, desnormalización, etapas, LP normalizado.
//
// UI components keep their own { en, es } string tables next to the markup
// (see e.g. FilterPanel.svelte) and pick one with the `lang` store.

export const LANGS = ['en', 'es']
export const DEFAULT_LANG = 'es'

/** Approximation names by approx_type index (0…6). */
export const APPROX_NAMES_BY_LANG = {
  en: ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Optimum L', 'Bessel', 'Gauss'],
  es: ['Butterworth', 'Chebyshev I', 'Chebyshev II', 'Cauer', 'Óptimo L', 'Bessel', 'Gauss'],
}

/** Filter type names by filter_type index (LP, HP, BP, BR, GD). */
export const TYPE_NAMES_BY_LANG = {
  en: ['Low-pass', 'High-pass', 'Band-pass', 'Band-reject', 'Group delay'],
  es: ['Pasa-bajos', 'Pasa-altos', 'Pasa-banda', 'Rechaza-banda', 'Retardo de grupo'],
}

/** Short type tags are the same in both languages (the guide uses LP / HP / BP / BR too). */
export const TYPE_SHORT = ['LP', 'HP', 'BP', 'BR', 'GD']

export const normLang = l => (LANGS.includes(l) ? l : DEFAULT_LANG)

export const approxName = (i, lang = DEFAULT_LANG) => APPROX_NAMES_BY_LANG[normLang(lang)][i] ?? `#${i}`
export const typeName = (i, lang = DEFAULT_LANG) => TYPE_NAMES_BY_LANG[normLang(lang)][i] ?? `#${i}`

/**
 * Fill `{name}` placeholders: fmt('N = {n}', { n: 4 }) → 'N = 4'.
 * Unknown placeholders are left as they are.
 */
export function fmt(str, vars) {
  if (!vars) return str
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/** Pick the table for `lang` from { en, es }, falling back to English per key. */
export function table(tables, lang) {
  const l = normLang(lang)
  return l === 'en' ? tables.en : { ...tables.en, ...tables[l] }
}

/** Spanish/English ordinal for "N-th order": 4 → '4th' / '4.º'. */
export function ordinal(n, lang = DEFAULT_LANG) {
  if (normLang(lang) === 'es') return `${n}.º`
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
