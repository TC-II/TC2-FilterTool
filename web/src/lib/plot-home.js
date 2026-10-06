// Where Plotly's Home button / double-click take the user.
//
// Plotly remembers an axis's "initial" range only on the very first draw, so
// a plot that later switches to another explicit range (a new design, the
// Stages tab's sticky y axis, a pole-zero map's frozen view) sent the user to
// a view they never saw. Call setHome() whenever the ranges FilterTool asks
// for change: explicit axes get their current range as home, autoranged axes
// go back to "fit the data".

/**
 * @param {HTMLElement} gd Plotly graph div (right after Plotly.react)
 * @param {Record<string, boolean>} explicit axis name → whether FilterTool gave it a range
 */
export function setHome(gd, explicit) {
  const fl = gd?._fullLayout
  if (!fl) return
  for (const [name, isExplicit] of Object.entries(explicit)) {
    const ax = fl[name]
    if (!ax) continue
    if (isExplicit && Array.isArray(ax.range)) {
      ax._rangeInitial0 = ax.range[0]
      ax._rangeInitial1 = ax.range[1]
      ax._autorangeInitial = false
    } else {
      ax._rangeInitial0 = undefined
      ax._rangeInitial1 = undefined
      ax._autorangeInitial = true
    }
  }
}
