// Light / dark switch as a circular reveal from the button that was clicked.
// The new theme is applied under a frozen snapshot of the old one (View
// Transitions API); the snapshot is only released once the plots have
// re-rendered in the new colours, so the switch never shows half-themed
// charts. Browsers without view transitions (or reduced motion) just switch.
import { tick } from 'svelte'
import { get } from 'svelte/store'
import { theme } from '../stores/app.js'
import { plotsIdle } from './plot-activity.js'

const wait = ms => new Promise(r => setTimeout(r, ms))
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

let running = false

/**
 * @param {'light'|'dark'} [next] target theme (default: the other one)
 * @param {{ x: number, y: number }} [origin] viewport point the reveal grows from
 */
export async function switchTheme(next, origin) {
  next ??= get(theme) === 'dark' ? 'light' : 'dark'
  if (running || next === get(theme)) return
  const doc = document
  if (!doc.startViewTransition || reducedMotion()) { theme.set(next); return }

  running = true
  const x = origin?.x ?? innerWidth - 40
  const y = origin?.y ?? 24
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const root = doc.documentElement
  root.dataset.themeSwitch = next

  try {
    const vt = doc.startViewTransition(async () => {
      theme.set(next)
      await tick()
      await wait(60)            // let the throttled plot refreshes start
      await plotsIdle(700)      // …and finish (capped, the snapshot must not hang)
    })
    await vt.ready
    const anim = root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 620, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    )
    await anim.finished.catch(() => {})
    await vt.finished.catch(() => {})
  } catch (err) {
    console.warn('Theme transition:', err)
    theme.set(next)
  } finally {
    delete root.dataset.themeSwitch
    running = false
  }
}
