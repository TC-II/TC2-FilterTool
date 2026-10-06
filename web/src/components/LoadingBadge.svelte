<script>
  import { engineReady, engineError, engineStatus, engineProgress, lang } from '../stores/app.js'
  import StableText from './StableText.svelte'

  // Status strings are stored in English (several places set them); they are
  // translated here, at display time.
  const STATUS_ES = {
    'Ready': 'Listo',
    'Computing…': 'Calculando…',
    'Loading WASM filter engine…': 'Cargando el motor de filtros (WASM)…',
    'WASM filter engine ready': 'Motor de filtros (WASM) listo',
    'Loading design…': 'Cargando diseño…',
    'Computing Bode…': 'Calculando Bode…',
  }
  const ERROR = { en: 'Error', es: 'Error' }
  // Once the engine is up the badge keeps saying Ready / Listo and shows a
  // small spinner while a design is computing, so its width never changes
  // (no header jump on every live redesign or language switch).
  const READY = { en: 'Ready', es: 'Listo' }
  $: busy = $engineReady && !$engineError && $engineStatus !== 'Ready'
  $: status = $lang === 'es' ? (STATUS_ES[$engineStatus] ?? $engineStatus) : $engineStatus
  $: text = $engineError ? `${ERROR[$lang] ?? ERROR.en}: ${$engineError}` : status
</script>

<span
  class="badge"
  class:ready={$engineReady}
  class:error={!!$engineError}
  title={text}
>
  {#if !$engineReady && !$engineError}
    <span class="spinner" aria-hidden="true"></span>
  {:else if $engineReady && !$engineError}
    <span class="spinner" class:idle={!busy} aria-hidden="true"></span>
  {/if}
  <span class="label">
    {#if $engineReady && !$engineError}
      <StableText text={READY[$lang] ?? READY.en} variants={Object.values(READY)} align="start" />
    {:else}
      {text}
    {/if}
  </span>
  {#if !$engineReady && !$engineError}
    <span class="bar-track" aria-hidden="true">
      <span class="bar-fill" style="width: {$engineProgress}%"></span>
    </span>
  {/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    padding: 0.22rem 0.55rem;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--text-dim);
    user-select: none;
    max-width: min(320px, 40vw);
    min-width: 0;
  }
  .badge:not(.ready):not(.error) { width: 220px; max-width: min(220px, 40vw); }
  .badge.ready { background: var(--success-bg); color: var(--success); }
  .badge.error { background: var(--danger-bg); color: var(--danger); max-width: min(420px, 55vw); }

  /* Ready: the spinner slot stays (fixed width) and only shows while computing */
  .spinner.idle { visibility: hidden; animation: none; }
  .spinner {
    width: 8px;
    height: 8px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    width: 48px;
    height: 3px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.35s ease;
    min-width: 4px;
  }

  @media (max-width: 720px) {
    .badge { max-width: min(160px, 30vw); }
    .badge:not(.ready):not(.error) { width: auto; max-width: min(160px, 30vw); }
  }
</style>
