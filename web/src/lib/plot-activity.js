// Counts plot redraws in flight (scheduled or rendering), so a caller can wait
// until every Plotly chart on screen has caught up — e.g. the theme switch
// holds its view-transition snapshot until the plots are recoloured.

let pending = 0
let waiters = []

/** Mark one redraw as pending. Call the returned function once it is done (idempotent). */
export function beginPlotWork() {
  pending++
  let done = false
  return () => {
    if (done) return
    done = true
    if (--pending === 0) for (const w of waiters.splice(0)) w()
  }
}

/** Resolves when no redraw is pending, or after `timeoutMs` (whichever comes first). */
export function plotsIdle(timeoutMs = 600) {
  if (pending === 0) return Promise.resolve()
  return new Promise(resolve => {
    const t = setTimeout(done, timeoutMs)
    function done() { clearTimeout(t); waiters = waiters.filter(w => w !== done); resolve() }
    waiters.push(done)
  })
}
