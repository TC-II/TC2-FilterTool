<script>
  export let title = ''
</script>

<div class="plot-panel">
  {#if title}
    <p class="plot-title">{title}</p>
  {/if}
  <div class="plot-area">
    <span class="placeholder">Plot coming in Phase 5</span>
  </div>
</div>

<style>
  .plot-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 0.5rem;
  }
  .plot-title {
    font-size: 0.78rem;
    color: #7d8590;
    margin: 0;
  }
  .plot-area {
    flex: 1;
    background: #0d1117;
    border: 1px dashed #21262d;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .placeholder {
    font-size: 0.78rem;
    color: #30363d;
  }
</style>
