<script>
  import { engineReady, engineError, engineStatus, engineProgress } from '../stores/app.js'
</script>

<span
  class="badge"
  class:ready={$engineReady}
  class:error={!!$engineError}
  title={$engineError ? `Error: ${$engineError}` : $engineStatus}
>
  {#if !$engineReady && !$engineError}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  <span class="label">
    {$engineError ? `Error: ${$engineError}` : $engineStatus}
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
