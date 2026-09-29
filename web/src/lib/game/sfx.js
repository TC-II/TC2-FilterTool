// 8-bit sound effects for the game mode. Same synth as neandertool's
// js/audio.js (square / triangle / sawtooth blips), plus a few extra cues.
// The AudioContext is created on the first sound, i.e. after a user gesture.

const KEY = 'filtertool.game.sound'

let ctx = null
let enabled = true
try { enabled = localStorage.getItem(KEY) !== '0' } catch { /* storage blocked */ }

function ensureContext() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone(frequency, duration = 0.1, type = 'square', volume = 0.2, delayMs = 0) {
  if (!enabled) return
  const play = () => {
    const c = ensureContext()
    if (!c) return
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = type
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(volume, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + duration)
    osc.connect(gain)
    gain.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + duration)
  }
  if (delayMs > 0) setTimeout(play, delayMs)
  else play()
}

/** Pitch glide (power-up / power-down sweeps). */
function sweep(f0, f1, duration, type = 'square', volume = 0.12) {
  if (!enabled) return
  const c = ensureContext()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(f0, c.currentTime)
  osc.frequency.exponentialRampToValueAtTime(f1, c.currentTime + duration)
  gain.gain.setValueAtTime(volume, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.01, c.currentTime + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + duration)
}

export const sfx = {
  get enabled() { return enabled },
  toggle() {
    enabled = !enabled
    try { localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* ignore */ }
    if (enabled) this.click()
    return enabled
  },

  /** neandertool playClick */
  click() {
    tone(2000, 0.03, 'square', 0.1)
    tone(1500, 0.02, 'square', 0.05)
  },
  /** Option picked */
  select() {
    tone(880, 0.05, 'square', 0.08)
    tone(1320, 0.04, 'square', 0.05, 40)
  },
  /** neandertool playSuccess: C5 E5 G5 C6 */
  success() {
    tone(523, 0.1, 'triangle')
    tone(659, 0.1, 'triangle', 0.2, 80)
    tone(784, 0.15, 'triangle', 0.2, 160)
    tone(1047, 0.2, 'triangle', 0.2, 260)
  },
  /** neandertool playFail */
  fail() {
    tone(100, 0.4, 'sawtooth', 0.3)
    tone(80, 0.5, 'sawtooth', 0.2, 200)
  },
  /** neandertool playRoundComplete: G4 A4 C5 E5 G5 */
  roundComplete() {
    ;[392, 440, 523, 659, 784].forEach((f, i) => tone(f, 0.2, 'triangle', 0.15, i * 100))
  },
  /** Entering game mode: rising sweep + arpeggio fanfare */
  powerUp() {
    sweep(180, 1400, 0.45, 'square', 0.09)
    ;[523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.12, 'square', 0.08, 420 + i * 70))
  },
  /** Leaving game mode */
  powerDown() {
    sweep(1200, 140, 0.5, 'square', 0.09)
    ;[784, 659, 523, 392].forEach((f, i) => tone(f, 0.12, 'triangle', 0.12, 350 + i * 90))
  },
}
