// Text for the pixel font. Press Start 2P covers Latin and Greek (ω, τ, π
// come in the same pixel style), but not math symbols: the browser falls back
// to a system font at the pixel font's size, so ∞ or ∠ show up tiny next to
// the blocky capitals. This swaps the ones with a clean ASCII spelling and
// wraps the rest in <span class="sym"> (scaled up in GameMode.svelte).

const ASCII = { '−': '-', '→': '->', '≫': '>>', '≳': '>~', '≈': '~', '≥': '>=', '≤': '<=' }
const SUP = { '⁺': '+', '⁻': '-' }
const SYMBOL = /[∞∠√∑∏∂∫]/

const esc = c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c)

/** Plain text → HTML safe for {@html}, tuned for the pixel font. */
export function pix(text) {
  let out = ''
  for (const ch of String(text ?? '')) {
    if (ASCII[ch]) out += [...ASCII[ch]].map(esc).join('')
    else if (SUP[ch]) out += `<sup>${esc(SUP[ch])}</sup>`
    else if (SYMBOL.test(ch)) out += `<span class="sym">${ch}</span>`
    else out += esc(ch)
  }
  return out
}
