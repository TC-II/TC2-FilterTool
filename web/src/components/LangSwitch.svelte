<script>
  // Language switch: 🍔 English · 🧉 Español. A two-position toggle; the
  // active side is highlighted and the thumb slides between them.
  import { lang } from '../stores/app.js'

  /** 'default' (app header) | 'pixel' (game mode header). */
  export let variant = 'default'

  const TITLE = { en: 'Language: English (click for Español)', es: 'Idioma: Español (clic para English)' }

  function toggle() {
    lang.update(l => (l === 'es' ? 'en' : 'es'))
  }
</script>

<button
  type="button"
  class="lang {variant}"
  class:es={$lang === 'es'}
  role="switch"
  aria-checked={$lang === 'es'}
  aria-label={$lang === 'es' ? 'Idioma: Español' : 'Language: English'}
  title={TITLE[$lang]}
  on:click={toggle}
>
  <span class="thumb" aria-hidden="true"></span>
  <span class="opt" class:on={$lang === 'en'} aria-hidden="true">🍔</span>
  <span class="opt" class:on={$lang === 'es'} aria-hidden="true">🧉</span>
</button>

<style>
  .lang {
    position: relative;
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    width: 3.5rem;
    height: 1.75rem;
    padding: 2px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    cursor: pointer;
  }
  .lang:hover { border-color: var(--accent); }
  .lang:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(50% - 2px);
    height: calc(100% - 4px);
    border-radius: 999px;
    background: var(--selected);
    box-shadow: inset 0 0 0 1px var(--accent);
    transition: transform 0.18s ease-out;
  }
  .lang.es .thumb { transform: translateX(100%); }

  .opt {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
    line-height: 1;
    filter: grayscale(0.85);
    opacity: 0.45;
    transition: opacity 0.15s, filter 0.15s;
  }
  .opt.on { filter: none; opacity: 1; }

  /* Game mode: square pixel look (neandertool colours) */
  .lang.pixel {
    width: 3.9rem;
    height: 2.1rem;
    border: 3px solid #8d6e63;
    border-radius: 0;
    background: #0d2035;
    box-shadow: 4px 4px 0 #5d4037;
  }
  .lang.pixel:hover { border-color: #00bcd4; }
  .lang.pixel .thumb {
    border-radius: 0;
    background: #0e3448;
    box-shadow: inset 0 0 0 2px #00bcd4;
    transition: transform 0.12s steps(3, end);
  }

  @media (prefers-reduced-motion: reduce) { .thumb, .opt { transition: none; } }
</style>
