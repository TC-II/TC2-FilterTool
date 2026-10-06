// Game mode enter / exit show: a pixel-block curtain wipes the screen, a
// retro "GAME MODE" splash drops in, and neandertool's coal buddy greets the
// player (or waves goodbye and hops away) with pixel confetti.
//
// The mode switch itself happens under the fully covered curtain, so the
// player never sees the layout swap.

// All subsets: Greek gives ω / τ in the pixel style (unicode-range loads them on demand)
import '@fontsource/press-start-2p/400.css'
import { get } from 'svelte/store'
import Mascot from './mascot.js'
import { sfx } from './sfx.js'
import { lang } from '../../stores/app.js'
import { table } from '../i18n.js'

/** Splash and mascot texts, in the current UI language. */
const TX = {
  en: { title: 'GAME MODE', subtitle: '> NAME THAT FILTER! <', hello: 'QUIZ TIME!', bye: 'SEE YA!', perfect: 'PERFECT!' },
  es: { title: 'MODO JUEGO', subtitle: '> ¡ADIVINE EL FILTRO! <', hello: '¡A JUGAR!', bye: '¡CHAU!', perfect: '¡PERFECTO!' },
}
const tx = () => table(TX, get(lang))

const CURTAIN_Z = 2000        // below the mascot layer (2100), above everything else
const SPLASH_Z = 2050
const BLOCK_PX = 22           // curtain block size (CSS px)

const NAVY = ['#0a1628', '#0c1a30']                      // settled blocks (checkerboard)
const SPARK = ['#00bcd4', '#7c4dff', '#ff9800', '#a0d8ef', '#8d6e63']

const wait = ms => new Promise(r => setTimeout(r, ms))
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

let mascotPromise = null
/** Load the mascot sprites once. Resolves to Mascot, or null when they can't load. */
export function initMascot() {
  if (!mascotPromise) {
    mascotPromise = Mascot.init({ version: '2' }).catch(err => {
      console.warn('Mascot init failed:', err)
      mascotPromise = null
      return null
    })
  }
  return mascotPromise
}

/** Mascot if it is ready within `ms`, else null (never blocks the transition). */
async function mascotWithin(ms) {
  return Promise.race([initMascot(), wait(ms).then(() => null)])
}

function safe(fn) {
  try { return Promise.resolve(fn()).catch(err => console.warn('Mascot:', err)) } catch (err) {
    console.warn('Mascot:', err)
    return Promise.resolve()
  }
}

// ── Pixel curtain ────────────────────────────────────────────────────────────
// One canvas pixel per block, upscaled with pixelated rendering. Blocks arrive
// in a diagonal sweep with jitter; each flashes a neon colour for a few frames
// before settling to navy (and flashes again right before it leaves).

class Curtain {
  constructor() {
    const cv = document.createElement('canvas')
    this.cols = Math.ceil(innerWidth / BLOCK_PX)
    this.rows = Math.ceil(innerHeight / BLOCK_PX)
    cv.width = this.cols
    cv.height = this.rows
    Object.assign(cv.style, {
      position: 'fixed', left: '0', top: '0',
      width: `${this.cols * BLOCK_PX}px`, height: `${this.rows * BLOCK_PX}px`,
      zIndex: String(CURTAIN_Z), imageRendering: 'pixelated', pointerEvents: 'auto',
    })
    cv.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cv)
    this.cv = cv
    this.ctx = cv.getContext('2d')

    const n = this.cols * this.rows
    const span = this.cols + this.rows
    const cells = []
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        cells.push({ x, y, key: (x + y) / span + Math.random() * 0.45, spark: SPARK[(Math.random() * SPARK.length) | 0] })
      }
    }
    cells.sort((a, b) => a.key - b.key)
    this.cells = cells
    this.n = n
  }

  /** Fill (cover) or clear (uncover) over `ms`. */
  run(cover, ms) {
    const { ctx, cells, n } = this
    const flash = Math.max(3, Math.round(n * 0.05))      // cells in the neon band
    return new Promise(resolve => {
      if (ms <= 0) {
        ctx.clearRect(0, 0, this.cols, this.rows)
        if (cover) for (const c of cells) { ctx.fillStyle = NAVY[(c.x + c.y) & 1]; ctx.fillRect(c.x, c.y, 1, 1) }
        resolve()
        return
      }
      const t0 = performance.now()
      const frame = now => {
        const p = Math.min(1, (now - t0) / ms)
        // Ease-in-out so the sweep starts and lands softly
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
        const k = Math.round(e * (n + flash))
        ctx.clearRect(0, 0, this.cols, this.rows)
        for (let i = 0; i < n; i++) {
          const c = cells[i]
          let color
          if (cover) {
            if (i >= k) continue
            color = k - i <= flash && p < 1 ? c.spark : NAVY[(c.x + c.y) & 1]
          } else {
            if (i < k - flash) continue
            color = i < k ? c.spark : NAVY[(c.x + c.y) & 1]
          }
          ctx.fillStyle = color
          ctx.fillRect(c.x, c.y, 1, 1)
        }
        if (p < 1) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
  }

  cover(ms) { return this.run(true, ms) }
  async uncover(ms) { await this.run(false, ms); this.destroy() }
  destroy() { this.cv.remove() }
}

// ── Splash text ──────────────────────────────────────────────────────────────

function injectSplashStyles() {
  if (document.getElementById('ft-game-splash-styles')) return
  const style = document.createElement('style')
  style.id = 'ft-game-splash-styles'
  style.textContent = `
.ft-splash{position:fixed;left:0;right:0;top:9vh;z-index:${SPLASH_Z};pointer-events:none;text-align:center;
  font-family:'Press Start 2P','Courier New',monospace;color:#fff;transition:opacity 220ms steps(4,end);}
.ft-splash.out{opacity:0;}
.ft-splash .t{display:inline-flex;gap:.05em;font-size:clamp(26px,6.2vw,72px);line-height:1;letter-spacing:.04em;
  text-shadow:.07em .07em 0 #5d4037,-.035em -.035em 0 #00bcd4;}
.ft-splash .t span{display:inline-block;transform:translateY(-120vh);animation:ft-drop 620ms steps(8,end) forwards;}
.ft-splash .t span.sp{width:.55em;}
.ft-splash .s{margin-top:1.1em;font-size:clamp(10px,1.6vw,18px);color:#a0d8ef;opacity:0;
  animation:ft-fade 1ms linear forwards, ft-blink 700ms step-end infinite;}
@keyframes ft-drop{0%{transform:translateY(-120vh)}70%{transform:translateY(.18em)}85%{transform:translateY(-.08em)}100%{transform:translateY(0)}}
@keyframes ft-fade{to{opacity:1}}
@keyframes ft-blink{50%{visibility:hidden}}
@media (prefers-reduced-motion: reduce){.ft-splash .t span{animation:none;transform:none}.ft-splash .s{animation:ft-fade 1ms linear forwards}}
`
  document.head.appendChild(style)
}

function showSplash(title, subtitle) {
  injectSplashStyles()
  const el = document.createElement('div')
  el.className = 'ft-splash'
  el.setAttribute('aria-hidden', 'true')
  const t = document.createElement('div')
  t.className = 't'
  ;[...title].forEach((ch, i) => {
    const span = document.createElement('span')
    if (ch === ' ') span.className = 'sp'
    else span.textContent = ch
    span.style.animationDelay = `${i * 55}ms`
    t.appendChild(span)
  })
  const s = document.createElement('div')
  s.className = 's'
  s.textContent = subtitle
  s.style.animationDelay = `${title.length * 55 + 450}ms, ${title.length * 55 + 450}ms`
  el.append(t, s)
  document.body.appendChild(el)
  return {
    async remove() {
      el.classList.add('out')
      await wait(230)
      el.remove()
    },
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let busy = false
export const transitionBusy = () => busy

/**
 * Enter game mode. `switchMode` runs while the screen is covered (mount the
 * game UI there); it may return a promise.
 */
export async function playEnter(switchMode) {
  if (busy) return
  busy = true
  const fast = reducedMotion()
  const curtain = new Curtain()
  try {
    initMascot()
    sfx.powerUp()
    const fontReady = document.fonts?.load?.('16px "Press Start 2P"').catch(() => {})
    await curtain.cover(fast ? 0 : 560)
    await switchMode()
    await Promise.race([fontReady, wait(350)])

    const t = tx()
    const splash = showSplash(t.title, t.subtitle)
    const M = await mascotWithin(fast ? 0 : 600)
    if (M) safe(() => M.greet(document.body, { text: t.hello, autoHideMs: 3600, dismissOnClick: true }))
    await wait(fast ? 300 : 1700)

    await splash.remove()
    if (M && !fast) safe(() => M.confetti(document.body, { durationMs: 2200 }))
    await curtain.uncover(fast ? 0 : 650)
  } catch (err) {
    console.error(err)
    curtain.destroy()
  } finally {
    busy = false
  }
}

/** Leave game mode: the mascot waves goodbye, then hops off as the curtain lifts. */
export async function playExit(switchMode) {
  if (busy) return
  busy = true
  const fast = reducedMotion()
  const curtain = new Curtain()
  try {
    sfx.powerDown()
    const M = await mascotWithin(150)
    if (M) safe(() => M.idle(document.body, { text: tx().bye }))
    await curtain.cover(fast ? 0 : 480)
    await switchMode()
    await wait(fast ? 100 : 650)
    if (M) await Promise.race([safe(() => M.hide()), wait(1600)])
    await curtain.uncover(fast ? 0 : 560)
  } catch (err) {
    console.error(err)
    curtain.destroy()
  } finally {
    busy = false
  }
}

/** Perfect round: the coal buddy celebrates over `el` with confetti. */
export async function celebrateOver(el, text = tx().perfect) {
  const M = await mascotWithin(300)
  if (!M) return
  return safe(() => M.celebrate(el ?? document.body, { durationMs: 2300, text }))
}
