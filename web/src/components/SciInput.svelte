<script>
  import { createEventDispatcher } from 'svelte'

  export let value    = 1.0
  export let min      = -Infinity
  export let max      = Infinity
  export let unit     = ''
  export let label    = ''
  export let disabled = false
  // logNudge=true  → arrow keys multiply/divide (good for frequency, capacitance, …)
  // logNudge=false → arrow keys add/subtract `step` (good for dB, order, …)
  export let logNudge = true
  export let step     = 1

  const dispatch = createEventDispatcher()

  // Ordered largest→smallest so we pick the best prefix for display
  const SI = [
    { p: 'T', f: 1e12 },
    { p: 'G', f: 1e9  },
    { p: 'M', f: 1e6  },
    { p: 'k', f: 1e3  },
    { p: '',  f: 1    },
    { p: 'm', f: 1e-3 },
    { p: 'µ', f: 1e-6 },
    { p: 'n', f: 1e-9 },
    { p: 'p', f: 1e-12 },
    { p: 'f', f: 1e-15 },
  ]

  function parse(str) {
    str = str.trim()
    if (!str) return NaN

    // plain number or scientific notation
    const plain = Number(str)
    if (!isNaN(plain)) return plain

    // EIA body notation: "2k2" = 2.2k, "4n7" = 4.7n, "1k0" = 1.0k
    // pattern: optional sign, integer digits, SI prefix, optional decimal digits
    const eia = str.match(/^([+-]?)(\d+)([TGMkmµunpf])(\d*)$/)
    if (eia) {
      const sign    = eia[1] === '-' ? -1 : 1
      const intPart = eia[2]
      const rawPfx  = eia[3] === 'u' ? 'µ' : eia[3]
      const decPart = eia[4]
      const entry   = SI.find(s => s.p === rawPfx)
      if (entry) {
        const num = parseInt(intPart) + (decPart ? parseInt(decPart) / 10 ** decPart.length : 0)
        return sign * num * entry.f
      }
    }

    // decimal notation with prefix: "2.2k", "330µ", "4.7n", "1u"
    const dec = str.match(/^([+-]?\d+\.?\d*(?:[eE][+-]?\d+)?)\s*([TGMkmµunpf])$/)
    if (!dec) return NaN
    const num    = parseFloat(dec[1])
    const prefix = dec[2] === 'u' ? 'µ' : dec[2]
    const entry  = SI.find(s => s.p === prefix)
    return entry ? num * entry.f : NaN
  }

  function format(num) {
    if (!isFinite(num)) return '—'
    const abs = Math.abs(num)
    // Exact / near-zero must not pick a tiny SI prefix (0 would become "0f")
    if (abs < 1e-15) return '0'
    // find the best prefix: largest factor where abs >= factor (with small tolerance)
    const entry = SI.find(s => abs >= s.f * 0.9995) ?? SI[SI.length - 1]
    const scaled = num / entry.f
    // 4 significant figures, strip trailing zeros
    const str = parseFloat(scaled.toPrecision(4)).toString()
    return `${str}${entry.p}`
  }

  let text    = format(value)
  let focused = false
  let error   = false

  function onFocus() {
    focused = true
    // show the raw number for editing
    text = isFinite(value) ? String(value) : ''
  }

  function onBlur() {
    focused = false
    commit()
  }

  function onKeydown(e) {
    if (e.key === 'Enter') { e.target.blur(); return }
    if (e.key === 'Escape') { text = format(value); error = false; e.target.blur(); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
      const direction  = e.key === 'ArrowUp' ? 1 : -1
      const parsed     = parse(text)
      const base       = isNaN(parsed) ? value : parsed
      let next
      if (logNudge) {
        // multiply/divide — each arrow tick moves ~12% (≈ one decade per 20 steps)
        next = base * Math.pow(10, direction * multiplier * 0.05)
      } else {
        // linear — add/subtract step
        next = base + direction * step * multiplier
      }
      applyValue(next)
    }
  }

  function commit() {
    const parsed = parse(text)
    if (isNaN(parsed) || parsed < min || parsed > max) {
      error = true
      text  = format(value)   // revert display
    } else {
      error = false
      if (parsed !== value) {
        value = parsed
        dispatch('change', parsed)
      }
      text = format(parsed)
    }
  }

  function applyValue(v) {
    const clamped = Math.min(max, Math.max(min, v))
    value = clamped
    text  = format(clamped)
    error = false
    dispatch('change', clamped)
  }

  // Sync display when value changes externally
  $: if (!focused) text = format(value)
</script>

<label class="sci-input" class:disabled>
  {#if label}
    <span class="label">{label}</span>
  {/if}
  <div class="input-row">
    <input
      type="text"
      class:error
      bind:value={text}
      {disabled}
      on:focus={onFocus}
      on:blur={onBlur}
      on:keydown={onKeydown}
      autocomplete="off"
      spellcheck="false"
    />
    {#if unit}
      <span class="unit">{unit}</span>
    {/if}
  </div>
  {#if error}
    <span class="error-msg">
      Invalid value{min !== -Infinity || max !== Infinity
        ? ` (${isFinite(min) ? format(min) : '−∞'} – ${isFinite(max) ? format(max) : '+∞'})`
        : ''}
    </span>
  {/if}
</label>

<style>
  .sci-input {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.88rem;
    flex: 1;
    min-width: 0;
    width: 100%;
  }
  .sci-input.disabled { opacity: 0.4; pointer-events: none; }

  .label {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .input-row {
    display: flex;
    align-items: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    min-width: 0;
  }
  .input-row:focus-within { border-color: var(--accent); }

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 0.88rem;
    padding: 0.35rem 0.45rem;
    width: 0;
    min-width: 0;
  }
  input.error { color: var(--danger); }

  .unit {
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 0 0.45rem 0 0;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .error-msg {
    color: var(--danger);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
</style>
