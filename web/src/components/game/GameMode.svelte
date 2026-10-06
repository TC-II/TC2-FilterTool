<script>
  // Game mode: "name that filter". Each round designs a random normalized
  // filter (Butterworth / Chebyshev I / II / Cauer / Legendre × LP / HP / BP /
  // BR) and shows one view of it. Choice rounds ask multiple-choice questions
  // about it; match rounds ask which of 4 plots of another view is the same filter;
  // line-up rounds overlay 3–4 approximations of one template to be named;
  // theory rounds are plot-less flash cards (multi-select).
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte'
  import { getWorkerApi } from '../../lib/worker-client.js'
  import {
    createRound, localViews, localRoundKinds, DEFAULT_SETTINGS, GAME_TYPES, GAME_APPROX,
    approxLabel, TYPE_SHORT, describeRound, givenLine, sanitizeSettings,
    isCorrect, isAnswered,
  } from '../../lib/game/quiz.js'
  import { sfx } from '../../lib/game/sfx.js'
  import { celebrateOver } from '../../lib/game/transition.js'
  import GamePlot from './GamePlot.svelte'
  import LangSwitch from '../LangSwitch.svelte'
  import { pix } from '../../lib/game/pixtext.js'
  import { lang } from '../../stores/app.js'
  import { table, fmt } from '../../lib/i18n.js'

  const dispatch = createEventDispatcher()

  // UI strings. Round content (prompts, options, explanations) comes from
  // quiz.js in the round's own language; this chrome follows $lang live.
  const TX = {
    en: {
      app: 'Filter quiz game mode', title: 'FILTER QUIZ',
      round: 'ROUND', score: 'SCORE', streak: 'STREAK', acc: 'ACC', best: 'BEST',
      sfxOn: 'SFX ON', sfxOff: 'SFX OFF', mute: 'Mute sound', unmute: 'Unmute sound',
      options: 'OPTIONS', exit: 'EXIT', exitTitle: 'Back to the normal mode',
      given: 'GIVEN', quest: 'QUEST',
      loading: 'LOADING', engineError: 'ENGINE ERROR', retry: 'RETRY',
      headMatch: 'Match the plot', headLineup: 'Name each curve', headTheory: 'Theory card',
      questions: n => `${n} question${n === 1 ? '' : 's'}`,
      multi: ' · pick all that apply', option: 'Option {n}',
      ok: 'OK', bad: 'X', why: 'WHY?', hide: 'HIDE',
      perfect: 'PERFECT!', notBad: 'NOT BAD', ouch: 'OUCH!',
      right: '{c}/{t} right', bonus: ' · streak bonus +{b}',
      next: 'NEXT >>', check: 'CHECK!',
      hint: 'keys 1–9 answer · enter {what}', hintNext: 'next', hintCheck: 'check',
      dialog: 'Game options', kinds: 'QUESTION TYPES', plots: 'PLOTS', types: 'FILTER TYPES', approxes: 'APPROXIMATIONS',
      note: 'Changes apply right away if the current round is still untouched, otherwise from the next one. Answers only list the approximations and types enabled here (a question with a single possible answer is skipped). Match rounds show 4 cards of mixed plot kinds, 1 to 4 of them from the given filter: magnitude, phase and pole-zero pair freely, the step response only with magnitude or pole-zero, and the group delay only as a card. Line-ups overlay 3–4 of the enabled approximations (at least 3 needed) on a magnitude, phase or pole-zero plot. Theory cards need no plot.',
      newRun: 'NEW RUN', close: 'CLOSE',
      cheerPerfect: 'PERFECT!', cheerStreak: '{n} IN A ROW!',
    },
    es: {
      app: 'Modo juego: quiz de filtros', title: 'QUIZ DE FILTROS',
      round: 'RONDA', score: 'PUNTOS', streak: 'RACHA', acc: 'PREC.', best: 'RÉCORD',
      sfxOn: 'SONIDO ON', sfxOff: 'SONIDO OFF', mute: 'Silenciar', unmute: 'Activar el sonido',
      options: 'OPCIONES', exit: 'SALIR', exitTitle: 'Volver al modo normal',
      given: 'DATO', quest: 'PREGUNTA',
      loading: 'CARGANDO', engineError: 'ERROR DEL MOTOR', retry: 'REINTENTAR',
      headMatch: 'Emparejar gráficos', headLineup: 'Identificar cada curva', headTheory: 'Tarjeta de teoría',
      questions: n => `${n} pregunta${n === 1 ? '' : 's'}`,
      multi: ' · marque todas las que correspondan', option: 'Opción {n}',
      why: '¿POR QUÉ?', hide: 'OCULTAR',
      perfect: '¡PERFECTO!', notBad: 'NADA MAL', ouch: '¡AUCH!',
      right: '{c}/{t} bien', bonus: ' · bonus por racha +{b}',
      next: 'SIGUIENTE >>', check: '¡VERIFICAR!',
      hint: 'teclas 1–9 responden · enter {what}', hintNext: 'sigue', hintCheck: 'verifica',
      dialog: 'Opciones del juego', kinds: 'TIPOS DE PREGUNTA', plots: 'GRÁFICOS', types: 'TIPOS DE FILTRO', approxes: 'APROXIMACIONES',
      note: 'Los cambios se aplican de inmediato si la ronda actual todavía no se respondió; si no, desde la siguiente. Las respuestas solo listan las aproximaciones y los tipos habilitados aquí (se omite una pregunta con una única respuesta posible). Las rondas de emparejar muestran 4 gráficos de distintos tipos, de 1 a 4 del filtro dado: módulo, fase y polos y ceros se combinan libremente, la respuesta al escalón solo con módulo o polos y ceros, y el retardo de grupo solo como opción. Las curvas superpuestas muestran 3–4 de las aproximaciones habilitadas (se necesitan al menos 3) sobre un gráfico de módulo, fase o polos y ceros. Las tarjetas de teoría no usan gráficos.',
      newRun: 'NUEVA PARTIDA', close: 'CERRAR',
      cheerPerfect: '¡PERFECTO!', cheerStreak: '¡{n} SEGUIDAS!',
    },
  }
  $: t = table(TX, $lang)
  $: views = localViews($lang)
  $: roundKinds = localRoundKinds($lang)

  const SETTINGS_KEY = 'filtertool.game.settings'
  const BEST_KEY = 'filtertool.game.best'
  const POINTS = 100

  function loadJSON(key, fallback) {
    try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || 'null') ?? {}) } } catch { return { ...fallback } }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage blocked */ }
  }

  // Sanitized: drops stale entries from older saves (e.g. the 'impulse' view, maxQuestions)
  let settings = sanitizeSettings(loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS))
  let best = loadJSON(BEST_KEY, { score: 0, streak: 0 })

  let round = null
  let roundNo = 0
  let loading = false
  let error = ''
  let answers = {}            // question index → option id (id array for multi-select)
  let openWhy = {}            // question index → explanation shown
  let checked = false
  let result = null           // { correct, total, gained, perfect }
  let score = 0
  let streak = 0
  let answered = 0
  let correctTotal = 0
  let showOptions = false
  let settingsDirty = false
  let soundOn = sfx.enabled
  let plotPanel
  let shakeKey = 0

  $: allAnswered = !!round && round.questions.every((q, i) => isAnswered(q, answers[i]))
  $: activeQ = round && !checked ? round.questions.findIndex((q, i) => !isAnswered(q, answers[i])) : -1
  // Keys keep toggling a multi-select question after its first pick
  $: keyQ = activeQ >= 0 ? activeQ : (round && !checked ? round.questions.findLastIndex(q => q.multi) : -1)
  $: accuracy = answered ? Math.round((100 * correctTotal) / answered) : null

  async function nextRound() {
    if (loading) return
    loading = true
    error = ''
    try {
      const r = await createRound(getWorkerApi(), { ...settings, lang: $lang }, Math.random, ++roundNo)
      answers = {}
      openWhy = {}
      checked = false
      result = null
      round = r
    } catch (e) {
      error = e?.message ?? String(e)
    } finally {
      loading = false
    }
    // The language changed while this round was being built: redraw it
    if (relang) {
      relang = false
      if (round && round.lang !== $lang && untouched()) nextRound()
    }
  }

  // ── Language: an untouched round is redrawn in the new language; one already
  // answered keeps its text, and the new language applies from the next round.
  let relang = false
  const untouched = () => !checked && Object.keys(answers).length === 0
  $: langChanged($lang)
  function langChanged(l) {
    if (!round || round.lang === l) return
    if (loading) { relang = true; return }
    if (untouched()) nextRound()
  }

  function choose(qi, id) {
    if (checked || !round) return
    if (round.questions[qi].multi) {
      const cur = answers[qi] ?? []
      answers = { ...answers, [qi]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }
    } else {
      answers = { ...answers, [qi]: id }
    }
    sfx.select()
  }

  function check() {
    if (!round || checked || !allAnswered) return
    checked = true
    const total = round.questions.length
    const correct = round.questions.filter((q, i) => isCorrect(q, answers[i])).length
    const perfect = correct === total
    streak = perfect ? streak + 1 : 0
    const bonus = perfect ? 50 * streak : 0
    const gained = correct * POINTS + bonus
    score += gained
    answered += total
    correctTotal += correct
    result = { correct, total, gained, bonus, perfect }

    if (score > best.score || streak > best.streak) {
      best = { score: Math.max(best.score, score), streak: Math.max(best.streak, streak) }
      saveJSON(BEST_KEY, best)
    }
    if (perfect) {
      sfx.success()
      setTimeout(() => sfx.roundComplete(), 450)
      celebrateOver(plotPanel, streak >= 3 ? fmt(t.cheerStreak, { n: streak }) : t.cheerPerfect)
    } else {
      sfx.fail()
      shakeKey++
    }
  }

  function primary() {
    if (checked) { sfx.click(); nextRound() } else check()
  }

  function exit() {
    sfx.click()
    dispatch('exit')
  }

  function toggleSound() {
    soundOn = sfx.toggle()
  }

  // ── Options ────────────────────────────────────────────────────────────
  function toggleIn(key, value) {
    const list = settings[key]
    const next = list.includes(value) ? list.filter(v => v !== value) : [...list, value]
    if (!next.length) return        // keep at least one
    settings = { ...settings, [key]: next }
    saveJSON(SETTINGS_KEY, settings)
    settingsDirty = true
    sfx.select()
  }
  /** Close Options; an unanswered round is redrawn so the new settings apply right away. */
  function closeOptions() {
    showOptions = false
    if (settingsDirty) {
      settingsDirty = false
      if (untouched()) nextRound()
    }
  }
  function resetRun() {
    score = 0; streak = 0; answered = 0; correctTotal = 0
    showOptions = false
    settingsDirty = false
    sfx.click()
    nextRound()
  }

  // ── Keyboard: 1–9 answer the first open question, Enter checks / advances ──
  function onKeydown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key === 'Escape') {
      if (showOptions) { closeOptions(); e.preventDefault() }
      return
    }
    if (showOptions) return
    if (e.key === 'Enter') {
      if (checked || allAnswered) { e.preventDefault(); primary() }
      return
    }
    if (/^[1-9]$/.test(e.key) && keyQ >= 0) {
      const q = round.questions[keyQ]
      const opt = q.options[Number(e.key) - 1]
      if (opt) { e.preventDefault(); choose(keyQ, opt.id) }
    }
  }

  // answers / checked are passed in (not read from the closure) so the class
  // re-evaluates when they change: Svelte only tracks what the expression names.
  function optionState(q, qi, opt, answers, checked) {
    const picked = q.multi ? (answers[qi] ?? []).includes(opt.id) : answers[qi] === opt.id
    if (!checked) return picked ? 'picked' : ''
    const right = q.multi ? q.answer.includes(opt.id) : opt.id === q.answer
    if (right) return picked ? 'right' : 'missed'
    return picked ? 'wrong' : 'dim'
  }
  const isPicked = (q, qi, opt, answers) => (q.multi ? (answers[qi] ?? []).includes(opt.id) : answers[qi] === opt.id)

  onMount(async () => {
    await tick()
    nextRound()
  })
  onDestroy(() => { loading = false })
</script>

<svelte:window on:keydown={onKeydown} />

<div
  class="game"
  role="application"
  aria-label={t.app}
  style:background-image={`url(${import.meta.env.BASE_URL}game/background.jpg)`}
>
  <div class="frame">
    <header>
      <h1><span class="coin" aria-hidden="true"></span>{t.title}</h1>
      <div class="hud">
        <div class="hud-box"><span class="k">{t.round}</span><span class="v">{roundNo}</span></div>
        <div class="hud-box"><span class="k">{t.score}</span><span class="v score">{score}</span></div>
        <div class="hud-box" class:hot={streak >= 2}><span class="k">{t.streak}</span><span class="v">{streak}{streak >= 2 ? '🔥' : ''}</span></div>
        <div class="hud-box"><span class="k">{t.acc}</span><span class="v">{accuracy == null ? '--' : `${accuracy}%`}</span></div>
        <div class="hud-box best"><span class="k">{t.best}</span><span class="v">{best.score}</span></div>
      </div>
      <div class="actions">
        <button class="px-btn small" on:click={toggleSound} aria-pressed={soundOn} title={soundOn ? t.mute : t.unmute}>
          {soundOn ? t.sfxOn : t.sfxOff}
        </button>
        <button class="px-btn small" class:active={showOptions} on:click={() => { sfx.click(); if (showOptions) closeOptions(); else showOptions = true }} aria-expanded={showOptions}>
          {t.options}
        </button>
        <LangSwitch variant="pixel" />
        <button class="px-btn small exit" on:click={exit} title={t.exitTitle}>{t.exit}</button>
      </div>
    </header>

    <div class="main" class:match={round?.kind === 'match'}>
      <section class="plot-panel" bind:this={plotPanel}>
        <div class="panel-head">
          <span class="tag">{t.given}</span>
          <span class="view-title">{@html round ? pix(round.view.title) : '...'}</span>
        </div>
        <div class="given">{round ? givenLine(round.spec, round) : ' '}</div>
        <div class="plot-box">
          {#if round?.kind === 'theory'}
            {#key round.id}
              <div class="card-view">
                <div class="flash">
                  <span class="flash-tag">{round.questions[0].cardLabel}</span>
                  <div class="flash-text">{@html pix(round.card)}</div>
                  <span class="flash-corner" aria-hidden="true">?</span>
                </div>
              </div>
            {/key}
          {:else if round}
            <GamePlot {round} />
          {/if}
          {#if loading}
            <div class="loading"><span>{t.loading}</span><span class="dots">...</span></div>
          {/if}
          {#if error}
            <div class="loading err">
              <span>{t.engineError}</span>
              <small>{error}</small>
              <button class="px-btn" on:click={nextRound}>{t.retry}</button>
            </div>
          {/if}
        </div>
      </section>

      <section class="q-panel">
        <div class="panel-head">
          <span class="tag">{t.quest}</span>
          <span class="view-title">{round
            ? (round.kind === 'match' ? t.headMatch
              : round.kind === 'lineup' ? t.headLineup
              : round.kind === 'theory' ? t.headTheory
              : t.questions(round.questions.length))
            : ''}</span>
        </div>

        <div class="q-list">
          {#if round}
            {#each round.questions as q, qi (round.id + ':' + qi)}
              {@const ok = checked && isCorrect(q, answers[qi])}
              <div
                class="q"
                class:match={q.type === 'match'}
                class:active={qi === activeQ}
                class:ok={checked && ok}
                class:bad={checked && !ok}
              >
                {#key checked && !ok ? shakeKey : 0}
                  <div class="q-inner" class:shake={checked && !ok}>
                    <div class="q-prompt">
                      <span class="q-num">Q{qi + 1}</span>
                      {#if q.swatch}<span class="swatch" style:background={q.swatch} aria-hidden="true"></span>{/if}
                      <span>{@html pix(q.prompt)}{#if q.multi}<span class="multi-hint">{t.multi}</span>{/if}</span>
                      {#if checked}<span class="verdict">{ok ? t.ok : t.bad}</span>{/if}
                    </div>
                    {#if q.type === 'match'}
                      <div class="cands" class:has-pick={!checked && isAnswered(q, answers[qi])}>
                        {#each q.options as opt, oi}
                          <button
                            class="cand {optionState(q, qi, opt, answers, checked)}"
                            disabled={checked}
                            on:click={() => choose(qi, opt.id)}
                            aria-pressed={isPicked(q, qi, opt, answers)}
                            aria-label={fmt(t.option, { n: oi + 1 })}
                          >
                            <span class="key">{oi + 1}</span>
                            {#if opt.tag}<span class="cand-tag">{opt.tag}</span>{/if}
                            <div class="thumb"><GamePlot round={opt.round} compact /></div>
                            {#if checked}<span class="cand-label">{opt.label}</span>{/if}
                          </button>
                        {/each}
                      </div>
                    {:else}
                      <div
                        class="opts"
                        class:one={q.options.some(o => o.label.length > 18)}
                        class:multi={q.multi}
                        class:has-pick={!checked && !q.multi && isAnswered(q, answers[qi])}
                      >
                        {#each q.options as opt, oi}
                          <button
                            class="opt {optionState(q, qi, opt, answers, checked)}"
                            disabled={checked}
                            on:click={() => choose(qi, opt.id)}
                            aria-pressed={isPicked(q, qi, opt, answers)}
                          >
                            <span class="key">{oi + 1}</span>{#if q.multi}<span class="box" aria-hidden="true">{isPicked(q, qi, opt, answers) ? '■' : ''}</span>{/if}{opt.label}
                          </button>
                        {/each}
                      </div>
                    {/if}
                    {#if checked}
                      <button
                        class="why-btn"
                        class:open={openWhy[qi]}
                        aria-expanded={!!openWhy[qi]}
                        on:click={() => { sfx.click(); openWhy = { ...openWhy, [qi]: !openWhy[qi] } }}
                      >{openWhy[qi] ? t.hide : t.why}</button>
                      {#if openWhy[qi]}
                        <p class="why">{q.explain}</p>
                      {/if}
                    {/if}
                  </div>
                {/key}
              </div>
            {/each}
          {/if}
        </div>

        <div class="q-foot">
          {#if result}
            <div class="result" class:perfect={result.perfect}>
              <div class="r-top">
                {result.perfect ? t.perfect : result.correct ? t.notBad : t.ouch}
                <span class="gain">+{result.gained}</span>
              </div>
              <div class="r-sub">
                {fmt(t.right, { c: result.correct, t: result.total })}{result.bonus ? fmt(t.bonus, { b: result.bonus }) : ''}
              </div>
              {#if describeRound(round)}<div class="reveal">{describeRound(round)}</div>{/if}
            </div>
          {/if}
          <button
            class="px-btn big"
            class:pulse={checked || allAnswered}
            disabled={!round || loading || (!checked && !allAnswered)}
            on:click={primary}
          >
            {checked ? t.next : t.check}
          </button>
          <div class="hint">{fmt(t.hint, { what: checked ? t.hintNext : t.hintCheck })}</div>
        </div>
      </section>
    </div>

    {#if showOptions}
      <div class="options-overlay" on:click|self={closeOptions} role="presentation">
        <div class="options-box" role="dialog" aria-label={t.dialog}>
          <div class="o-title">{t.options}</div>

          <div class="o-group">
            <div class="o-lbl">{t.kinds}</div>
            <div class="chips">
              {#each roundKinds as k}
                <button class="chip" class:on={settings.kinds.includes(k.id)} on:click={() => toggleIn('kinds', k.id)}>{k.label}</button>
              {/each}
            </div>
          </div>
          <div class="o-group">
            <div class="o-lbl">{t.plots}</div>
            <div class="chips">
              {#each views as v}
                <button class="chip" class:on={settings.views.includes(v.id)} on:click={() => toggleIn('views', v.id)}>{v.label}</button>
              {/each}
            </div>
          </div>
          <div class="o-group">
            <div class="o-lbl">{t.types}</div>
            <div class="chips">
              {#each GAME_TYPES as ft}
                <button class="chip" class:on={settings.types.includes(ft)} on:click={() => toggleIn('types', ft)}>{TYPE_SHORT[ft]}</button>
              {/each}
            </div>
          </div>
          <div class="o-group">
            <div class="o-lbl">{t.approxes}</div>
            <div class="chips">
              {#each GAME_APPROX as a}
                <button class="chip" class:on={settings.approxes.includes(a)} on:click={() => toggleIn('approxes', a)}>{approxLabel(a, $lang)}</button>
              {/each}
            </div>
          </div>
          <p class="o-note">{t.note}</p>
          <div class="o-actions">
            <button class="px-btn" on:click={resetRun}>{t.newRun}</button>
            <button class="px-btn" on:click={() => { sfx.click(); closeOptions() }}>{t.close}</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .game {
    --bg-dark: #0a1628;
    --bg-panel: #0d2035;
    --ice: #a0d8ef;
    --ice-light: #d4f1f9;
    --brown: #8d6e63;
    --brown-dark: #5d4037;
    --cyan: #00bcd4;
    --purple: #7c4dff;
    --orange: #ff9800;
    --red: #f44336;
    --green: #4caf50;
    --px: 'Press Start 2P', 'Courier New', monospace;

    position: fixed;
    inset: 0;
    z-index: 60;
    background-color: var(--bg-dark);
    background-position: center;
    background-size: cover;
    image-rendering: pixelated;
    color: #fff;
    font-family: var(--px);
    font-size: 10px;
    display: flex;
    padding: 12px;
  }

  .frame {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: rgba(10, 22, 40, 0.92);
    border: 4px solid var(--brown);
    box-shadow: 8px 8px 0 var(--brown-dark);
    margin: 0 8px 8px 0;
    padding: 14px 16px;
  }
  .frame::before {
    content: '';
    position: absolute;
    inset: -4px;
    border: 2px solid var(--cyan);
    pointer-events: none;
    z-index: 3;
  }

  header {
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 4px solid var(--brown);
    padding-bottom: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    font-size: 20px;
    font-weight: normal;
    letter-spacing: 2px;
    text-shadow: 3px 3px 0 var(--brown-dark);
    white-space: nowrap;
  }
  .coin {
    width: 14px;
    height: 14px;
    background: var(--orange);
    box-shadow: inset -3px -3px 0 #c66900, 0 0 0 2px var(--brown-dark);
    animation: coin-spin 1.2s steps(4, end) infinite;
  }
  @keyframes coin-spin {
    0%, 100% { transform: scaleX(1); }
    25% { transform: scaleX(0.55); }
    50% { transform: scaleX(0.15); }
    75% { transform: scaleX(0.55); }
  }

  /* Keep the 5 boxes on one row when they fit (412px = 5 × 76 + 4 × 8): the action buttons wrap first */
  .hud { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; min-width: min(100%, 412px); }
  .hud-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-panel);
    border: 2px solid var(--brown-dark);
    padding: 6px 10px;
    min-width: 76px;
  }
  .hud-box .k { font-size: 8px; color: var(--ice); }
  .hud-box .v { font-size: 13px; color: #fff; }
  .hud-box .v.score { color: var(--orange); }
  .hud-box.hot { border-color: var(--orange); }
  .hud-box.best .v { color: var(--green); }

  .actions { display: flex; gap: 8px; }

  .px-btn {
    font-family: var(--px);
    font-size: 11px;
    color: #fff;
    background: var(--bg-panel);
    border: 3px solid var(--brown);
    box-shadow: 4px 4px 0 var(--brown-dark);
    padding: 10px 14px;
    cursor: pointer;
    white-space: nowrap;
    transition: transform 60ms steps(2, end);
  }
  .px-btn:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan); }
  .px-btn:active:not(:disabled) { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--brown-dark); }
  .px-btn:disabled { opacity: 0.4; cursor: default; }
  .px-btn.small { font-size: 9px; padding: 8px 10px; }
  .px-btn.active { border-color: var(--cyan); color: var(--cyan); }
  .px-btn.exit:hover { border-color: var(--red); color: var(--red); }
  .px-btn.big { width: 100%; font-size: 14px; padding: 14px; }
  .px-btn.big:not(:disabled) { background: var(--cyan); color: var(--bg-dark); border-color: #fff; }
  .px-btn.big:not(:disabled):hover { background: #33d6ea; color: var(--bg-dark); }
  .px-btn.pulse:not(:disabled) { animation: next-pulse 0.8s ease-in-out infinite; }
  @keyframes next-pulse {
    0%, 100% { box-shadow: 4px 4px 0 var(--brown-dark), 0 0 0 0 rgba(0, 188, 212, 0.7); }
    50% { box-shadow: 4px 4px 0 var(--brown-dark), 0 0 0 6px rgba(0, 188, 212, 0); }
  }

  .main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
    gap: 14px;
  }

  section {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border: 3px solid var(--brown-dark);
    padding: 10px;
  }
  .panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .tag {
    font-size: 8px;
    color: var(--bg-dark);
    background: var(--orange);
    padding: 4px 6px;
  }
  .view-title { font-size: 12px; color: #fff; text-shadow: 2px 2px 0 var(--brown-dark); }
  /* Math symbols the pixel font lacks (lib/game/pixtext.js): system glyph, scaled to match */
  .game :global(.sym) {
    font-family: 'Segoe UI Symbol', 'Cambria Math', 'DejaVu Sans', 'Noto Sans Math', serif;
    font-size: 1.55em;
    font-weight: 700;
    line-height: 0;
    vertical-align: -0.12em;
    text-shadow: none;
  }
  .game :global(sup) { font-size: 0.7em; line-height: 0; vertical-align: 0.6em; }
  .given {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
    color: var(--ice);
    margin-bottom: 8px;
    min-height: 1.2em;
  }
  .plot-box {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    border: 2px solid #1b3a58;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(13, 32, 53, 0.8);
    font-size: 14px;
    color: var(--cyan);
    z-index: 20;
  }
  .loading .dots { animation: blink 0.6s step-end infinite alternate; }
  .loading.err { color: var(--red); }
  .loading small { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ice-light); max-width: 80%; text-align: center; }
  @keyframes blink { 50% { opacity: 0; } }

  .q-panel { gap: 0; }
  .q-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .q {
    border: 2px solid #1b3a58;
    background: rgba(10, 22, 40, 0.6);
  }
  .q.active { border-color: var(--cyan); }
  .q.ok { border-color: var(--green); }
  .q.bad { border-color: var(--red); }
  .q-inner { padding: 10px; }
  .q-inner.shake { animation: shake 360ms steps(6, end); }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  .q-prompt {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 10px;
    line-height: 1.6;
    margin-bottom: 10px;
  }
  .q-num { color: var(--orange); flex-shrink: 0; }
  .swatch {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    align-self: center;
    border: 2px solid #fff;
    box-shadow: 2px 2px 0 var(--brown-dark);
  }
  .multi-hint { color: var(--ice); font-size: 8px; }

  /* Multi-select: a tick box per option; picks don't fade the others */
  .opt .box {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    line-height: 1;
    border: 2px solid currentColor;
  }

  /* Theory card: a big pixel flash card instead of a plot */
  .card-view {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background:
      repeating-linear-gradient(45deg, rgba(160, 216, 239, 0.04) 0 8px, transparent 8px 16px),
      var(--bg-dark);
  }
  .flash {
    position: relative;
    width: min(560px, 100%);
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 36px 28px;
    background: var(--ice-light);
    color: var(--bg-dark);
    border: 4px solid #fff;
    box-shadow: 0 0 0 4px var(--brown), 10px 10px 0 4px var(--brown-dark);
    animation: card-in 420ms steps(6, end);
  }
  .flash-tag {
    position: absolute;
    top: -14px;
    left: 18px;
    font-size: 9px;
    color: var(--bg-dark);
    background: var(--orange);
    padding: 5px 8px;
    border: 2px solid var(--brown-dark);
  }
  .flash-text {
    font-size: 16px;
    line-height: 1.7;
    text-align: center;
    text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.12);
  }
  .flash-corner {
    position: absolute;
    right: 14px;
    bottom: 10px;
    font-size: 22px;
    color: var(--cyan);
    text-shadow: 2px 2px 0 var(--brown-dark);
  }
  @keyframes card-in {
    0% { transform: perspective(600px) rotateY(90deg); }
    100% { transform: perspective(600px) rotateY(0); }
  }
  .verdict { margin-left: auto; font-size: 13px; }
  .q.ok .verdict { color: var(--green); }
  .q.bad .verdict { color: var(--red); }

  /* Match rounds: the options panel gets more room for the 2×2 plot grid */
  .main.match { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); }
  /* Grow with the WHY? text instead of squeezing the cards (the list scrolls) */
  .q.match { flex: 1 0 auto; display: flex; flex-direction: column; min-height: 420px; }
  .q.match > .q-inner { flex: 1 0 auto; display: flex; flex-direction: column; }
  .cands {
    flex: 1 0 auto;
    min-height: 340px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: repeat(2, minmax(160px, 1fr));
    gap: 8px;
  }
  .cand {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 150px;
    padding: 4px;
    background: var(--bg-dark);
    border: 2px solid #2a4a6b;
    cursor: pointer;
    text-align: left;
  }
  .cand .key {
    position: absolute;
    left: 6px;
    top: 6px;
    z-index: 6;
    font-family: var(--px);
    font-size: 9px;
    color: var(--bg-dark);
    background: #5d7fa0;
    padding: 4px 5px;
  }
  .cand-tag {
    position: absolute;
    right: 6px;
    top: 6px;
    z-index: 6;
    font-family: var(--px);
    font-size: 7px;
    color: var(--ice);
    background: rgba(10, 22, 40, 0.85);
    border: 1px solid #2a4a6b;
    padding: 3px 5px;
    text-transform: uppercase;
    pointer-events: none;
  }
  /* The plot is only a picture here: clicks go to the button */
  .cand .thumb { flex: 1; min-height: 0; display: flex; pointer-events: none; }
  .cand-label {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 11.5px;
    color: #fff;
    padding: 4px 2px 1px;
  }
  .cand:hover:not(:disabled) { border-color: var(--cyan); }
  .cand:disabled { cursor: default; }
  .cand.picked { border-color: #fff; box-shadow: 0 0 0 3px var(--cyan), 3px 3px 0 3px var(--brown-dark); }
  .cand.picked .key { background: var(--cyan); }
  .cand.right { border-color: var(--green); box-shadow: 0 0 0 3px var(--green); }
  .cand.right .key { background: var(--green); }
  .cand.wrong { border-color: var(--red); box-shadow: 0 0 0 3px var(--red); }
  .cand.wrong .key { background: var(--red); }
  .cand.missed { border-color: var(--green); box-shadow: 0 0 0 3px var(--green); animation: blink-green 0.5s step-end 4; }
  .cand.missed .key { background: var(--green); }
  .cand.dim { opacity: 0.5; }
  .cands.has-pick .cand:not(.picked) { opacity: 0.6; }
  .cands.has-pick .cand:not(.picked):hover { opacity: 1; }

  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .opts.one { grid-template-columns: 1fr; }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12.5px;
    color: var(--ice-light);
    background: var(--bg-dark);
    border: 2px solid #2a4a6b;
    padding: 7px 8px;
    cursor: pointer;
  }
  .opt .key {
    font-family: var(--px);
    font-size: 8px;
    color: var(--bg-dark);
    background: #5d7fa0;
    padding: 3px 4px;
    flex-shrink: 0;
  }
  .opt:hover:not(:disabled) { border-color: var(--cyan); color: #fff; }
  .opt:disabled { cursor: default; }
  /* Picked: solid cyan block + pixel shadow, the other options fade back */
  .opt.picked {
    border-color: #fff;
    background: var(--cyan);
    color: var(--bg-dark);
    font-weight: 700;
    box-shadow: 3px 3px 0 var(--brown-dark);
    transform: translate(-1px, -1px);
  }
  .opt.picked .key { background: var(--bg-dark); color: var(--cyan); }
  .opts.has-pick .opt:not(.picked) { opacity: 0.55; }
  .opts.has-pick .opt:not(.picked):hover { opacity: 1; }
  .opt.right { border-color: var(--green); background: #173a1f; color: #fff; }
  .opt.right .key { background: var(--green); }
  .opt.wrong { border-color: var(--red); background: #3d1515; color: #fff; text-decoration: line-through; }
  .opt.wrong .key { background: var(--red); }
  .opt.missed { border-color: var(--green); color: #fff; animation: blink-green 0.5s step-end 4; }
  .opt.missed .key { background: var(--green); }
  .opt.dim { opacity: 0.45; }
  @keyframes blink-green { 50% { background: #173a1f; } }

  .why-btn {
    align-self: flex-start;
    margin-top: 10px;
    font-family: var(--px);
    font-size: 9px;
    color: var(--bg-dark);
    background: var(--ice);
    border: 2px solid #fff;
    box-shadow: 3px 3px 0 var(--brown-dark);
    padding: 6px 9px;
    cursor: pointer;
  }
  .why-btn:hover { background: var(--cyan); }
  .why-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--brown-dark); }
  .why-btn.open { background: var(--bg-dark); color: var(--ice); border-color: var(--ice); }
  .why {
    margin: 10px 0 0;
    padding: 10px;
    /* Same face as the options: far more readable than the pixel font for prose */
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-line;
    color: var(--ice-light);
    background: var(--bg-dark);
    border: 2px dashed #2a4a6b;
    animation: pop 180ms steps(3, end);
  }

  .q-foot { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
  .result {
    border: 3px solid var(--red);
    background: var(--bg-dark);
    padding: 10px;
    animation: pop 240ms steps(4, end);
  }
  .result.perfect { border-color: var(--green); }
  @keyframes pop { from { transform: scale(0.6); } to { transform: scale(1); } }
  .r-top { display: flex; justify-content: space-between; font-size: 14px; color: var(--red); text-shadow: 2px 2px 0 var(--brown-dark); }
  .result.perfect .r-top { color: var(--green); }
  .gain { color: var(--orange); }
  .r-sub { margin-top: 8px; font-size: 8px; color: var(--ice); }
  .reveal {
    margin-top: 8px;
    font-size: 9px;
    line-height: 1.7;
    color: #fff;
  }
  .hint { font-size: 7px; color: #5d7fa0; text-align: center; }

  .options-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: rgba(10, 22, 40, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .options-box {
    background: var(--bg-panel);
    border: 4px solid var(--brown);
    box-shadow: 10px 10px 0 var(--brown-dark);
    padding: 24px;
    width: min(620px, 92%);
    max-height: 90%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .o-title { font-size: 18px; text-shadow: 3px 3px 0 var(--brown-dark); }
  .o-lbl { font-size: 9px; color: var(--ice); margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-family: var(--px);
    font-size: 9px;
    color: #5d7fa0;
    background: var(--bg-dark);
    border: 2px solid #2a4a6b;
    padding: 7px 9px;
    cursor: pointer;
  }
  .chip.on { color: var(--bg-dark); background: var(--cyan); border-color: #fff; }
  .o-note { margin: 0; font-size: 8px; line-height: 1.8; color: var(--ice); }
  .o-actions { display: flex; justify-content: flex-end; gap: 10px; }

  @media (max-width: 900px) {
    .main, .main.match { grid-template-columns: 1fr; grid-template-rows: minmax(260px, 1fr) auto; overflow-y: auto; }
    .q-list { overflow: visible; }
    h1 { font-size: 15px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .coin, .px-btn.pulse, .q-inner.shake, .opt.missed, .result, .flash { animation: none !important; }
  }
</style>
