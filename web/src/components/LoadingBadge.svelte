<script>
  import { pyodideReady, pyodideError, pyodideStatus, pyodideProgress } from '../stores/app.js'
</script>

<span
  class="badge"
  class:ready={$pyodideReady}
  class:error={!!$pyodideError}
>
  {#if !$pyodideReady && !$pyodideError}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  <span class="label">
    {$pyodideError ? `Error: ${$pyodideError}` : $pyodideStatus}
  </span>
  {#if !$pyodideReady && !$pyodideError}
    <span class="bar-track" aria-hidden="true">
      <span class="bar-fill" style="width: {$pyodideProgress}%"></span>
    </span>
  {/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    padding: 0.2rem 0.65rem;
    border-radius: 999px;
    background: #21262d;
    color: #7d8590;
    white-space: nowrap;
    user-select: none;
  }
  /* Fixed width only while loading so the bar stays anchored */
  .badge:not(.ready):not(.error) { width: 240px; }
  .badge.ready { background: #0d2016; color: #3fb950; }
  .badge.error { background: #2d1b1b; color: #f85149; }

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
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bar-track {
    width: 56px;
    height: 3px;
    background: #30363d;
    border-radius: 999px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .bar-fill {
    display: block;
    height: 100%;
    background: #58a6ff;
    border-radius: 999px;
    transition: width 0.35s ease;
    min-width: 4px;
  }
</style>
