<script>
  import SciInput from './SciInput.svelte'

  const cases = [
    { label: 'Passband freq', value: 1000,   min: 1,    max: 1e9,  unit: 'Hz', logNudge: true  },
    { label: 'Stopband freq', value: 2000,   min: 1,    max: 1e9,  unit: 'Hz', logNudge: true  },
    { label: 'Ripple',        value: 3,      min: 0.01, max: 40,   unit: 'dB', logNudge: false, step: 0.5 },
    { label: 'Attenuation',   value: 40,     min: 1,    max: 120,  unit: 'dB', logNudge: false, step: 1   },
    { label: 'Capacitor',     value: 4.7e-9, min: 1e-15,max: 1,    unit: 'F',  logNudge: true  },
    { label: 'Inductance',    value: 220e-6, min: 1e-12,max: 10,   unit: 'H',  logNudge: true  },
  ]

  let log = []
  function onChange(label, val) {
    log = [`${label} → ${val}`, ...log].slice(0, 6)
  }
</script>

<div class="test">
  <h3>SciInput test</h3>
  <div class="grid">
    {#each cases as c}
      <SciInput
        bind:value={c.value}
        label={c.label}
        min={c.min}
        max={c.max}
        unit={c.unit}
        logNudge={c.logNudge}
        step={c.step ?? 1}
        on:change={e => onChange(c.label, e.detail)}
      />
    {/each}
  </div>
  {#if log.length}
    <div class="log">
      {#each log as entry}<div>{entry}</div>{/each}
    </div>
  {/if}
</div>

<style>
  .test { padding: 1rem; }
  h3 { font-size: 0.85rem; color: #58a6ff; margin-bottom: 1rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; max-width: 480px; }
  .log { margin-top: 1rem; font-family: monospace; font-size: 0.75rem; color: #7d8590; }
</style>
