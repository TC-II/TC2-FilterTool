// Coal-buddy mascot + pixel confetti, ported from TC-II/neandertool
// (js/mascot.js). Same sprites (public/game/mascot, regenerated with
// neandertool's tools/mascot) and same API; only wrapped as an ES module and
// pointed at this app's asset path.
//
// API (default export `Mascot`):
//   Mascot.init(options)                        → Promise
//   Mascot.greet(container?, options?)          → Promise (resolves when hidden)
//   Mascot.celebrate(container?, { durationMs }) → Promise (resolves when done)
//   Mascot.idle(container?, options?)           → Promise (resolves when hidden)
//   Mascot.confetti(container?, options?)       → Promise
//   Mascot.hide(options?)                       → Promise
//
// Everything is mounted in document.body with position: fixed. `container` is
// only used to center the mascot over it (getBoundingClientRect already
// reflects CSS zoom).
const Mascot = (function (global) {
    
    var DEFAULTS = {
        basePath: `${import.meta.env.BASE_URL}game/mascot/`,
        version: '',            // appended as ?v= to sprite URLs for cache busting
        scale: 0,               // integer pixel scale; 0 = auto from viewport
        maxScale: 4,
        zIndex: 2100,           // above the pixel-wipe curtain (lib/game/transition.js)
        reducedMotion: 'auto',  // 'auto' | true | false
        greetText: 'HELLO!',
        greetAutoHideMs: 4000,
        celebrateDurationMs: 2500,
    };

    // Copy of assets/mascot/mascot.json, used when it can't be fetched (e.g. the
    // page opened from file://, where fetch() is blocked but <img> still loads).
    // Keep in sync when regenerating the sprites.
    var FALLBACK_META = {
        revision: 2, frameWidth: 96, frameHeight: 112, groundY: 107,
        animations: {
            idle:      { file: 'idle.png',      frames: 16, fps: 8,  loop: true },
            greet:     { file: 'greet.png',     frames: 24, fps: 12, loop: false },
            celebrate: { file: 'celebrate.png', frames: 12, fps: 12, loop: true },
            exit:      { file: 'exit.png',      frames: 12, fps: 14, loop: false },
        },
    };

    var PALETTE = ['#00bcd4', '#7c4dff', '#ff9800', '#4caf50', '#f44336', '#ffffff', '#a0d8ef', '#8d6e63'];
    var FADE_MS = 220;

    var opts = assign({}, DEFAULTS);
    var meta = null;
    var images = {};
    var initPromise = null;

    var layer = null, stage = null, canvas = null, ctx = null, bubble = null;
    var anim = null;          // { name, frame, acc, loop, onEnd }
    var rafId = 0, lastTs = 0;
    var session = null;       // current show: { id, resolve, timers[], cleanup[] }
    var sessionSeq = 0;
    var confettiFx = null;

    function assign(t) {
        for (var i = 1; i < arguments.length; i++) {
            var s = arguments[i];
            if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
        }
        return t;
    }

    function reducedMotion() {
        if (opts.reducedMotion === true || opts.reducedMotion === false) return opts.reducedMotion;
        return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // ── Styles ────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('nt-mascot-styles')) return;
        var css = [
            '.nt-mascot-layer{position:fixed;inset:0;pointer-events:none;overflow:hidden;opacity:1;transition:opacity ' + FADE_MS + 'ms linear;}',
            '.nt-mascot-layer.nt-fade{opacity:0;}',
            '.nt-mascot-confetti{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}',
            '.nt-mascot-stage{position:absolute;left:0;top:0;transform-origin:50% 100%;}',
            '.nt-mascot-stage canvas{display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;}',
            '.nt-mascot-bubble{position:absolute;left:50%;bottom:100%;transform:translate(-50%,0) scale(0);transform-origin:50% 100%;',
            'white-space:nowrap;font-family:"Press Start 2P","Courier New",monospace;font-size:14px;line-height:1;color:#fff;',
            'background:#0d2035;padding:10px 12px;border:4px solid #fff;box-shadow:4px 4px 0 #5d4037;',
            'transition:transform 160ms steps(4,end);}',
            '.nt-mascot-bubble::after{content:"";position:absolute;left:50%;top:100%;margin-left:-6px;width:12px;height:12px;',
            'background:#fff;clip-path:polygon(0 0,100% 0,50% 100%);}',
            '.nt-mascot-bubble.nt-show{transform:translate(-50%,0) scale(1);}',
            '@media (prefers-reduced-motion: reduce){.nt-mascot-bubble,.nt-mascot-layer{transition:none;}}',
        ].join('');
        var style = document.createElement('style');
        style.id = 'nt-mascot-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ── Loading ───────────────────────────────────────────────────────────
    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Mascot: failed to load ' + src)); };
            img.src = src;
        });
    }

    function url(file) {
        var base = opts.basePath.replace(/\/?$/, '/');
        return base + file + (opts.version ? '?v=' + encodeURIComponent(opts.version) : '');
    }

    function init(options) {
        assign(opts, options);
        if (initPromise) return initPromise;
        injectStyles();
        initPromise = fetch(url('mascot.json'))
            .then(function (r) {
                if (!r.ok) throw new Error('Mascot: mascot.json ' + r.status);
                return r.json();
            })
            .catch(function (err) {
                console.info('Mascot: using built-in metadata (' + err.message + ')');
                return FALLBACK_META;
            })
            .then(function (json) {
                meta = json;
                var names = Object.keys(meta.animations);
                return Promise.all(names.map(function (n) {
                    return loadImage(url(meta.animations[n].file)).then(function (img) { images[n] = img; });
                }));
            })
            .then(function () { return api; })
            .catch(function (err) { initPromise = null; throw err; });
        return initPromise;
    }

    // ── DOM ───────────────────────────────────────────────────────────────
    function ensureLayer() {
        if (layer) return;
        layer = document.createElement('div');
        layer.className = 'nt-mascot-layer';
        layer.setAttribute('aria-hidden', 'true');
        stage = document.createElement('div');
        stage.className = 'nt-mascot-stage';
        canvas = document.createElement('canvas');
        canvas.width = meta.frameWidth;
        canvas.height = meta.frameHeight;
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        bubble = document.createElement('div');
        bubble.className = 'nt-mascot-bubble';
        stage.appendChild(bubble);
        stage.appendChild(canvas);
        layer.appendChild(stage);
    }

    function mount() {
        ensureLayer();
        layer.style.zIndex = String(opts.zIndex);
        layer.classList.remove('nt-fade');
        if (!layer.parentNode) document.body.appendChild(layer);
    }

    function unmount() {
        stopLoop();
        stopConfetti();
        bubble.classList.remove('nt-show');
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer.classList.remove('nt-fade');
    }

    function pixelScale() {
        if (opts.scale > 0) return opts.scale;
        var fit = Math.floor(Math.min(global.innerWidth, global.innerHeight) * 0.42 / meta.frameHeight);
        return Math.max(1, Math.min(opts.maxScale, fit));
    }

    function targetRect(container) {
        if (container && container !== document.body && container.getBoundingClientRect) {
            var r = container.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return r;
        }
        return { left: 0, top: 0, width: global.innerWidth, height: global.innerHeight };
    }

    // Places the stage so the sprite's center sits at the rect's center.
    function placeStage(container) {
        var s = pixelScale();
        var w = meta.frameWidth * s, h = meta.frameHeight * s;
        var r = targetRect(container);
        var x = Math.round(r.left + r.width / 2 - w / 2);
        var y = Math.round(r.top + r.height / 2 - h / 2);
        stage.style.width = w + 'px';
        stage.style.height = h + 'px';
        stage.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        bubble.style.fontSize = Math.max(10, Math.round(s * 4)) + 'px';
        bubble.style.marginBottom = Math.round(-h * 0.12) + 'px';
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, scale: s };
    }

    // ── Sprite player ─────────────────────────────────────────────────────
    function play(name, loop, onEnd) {
        anim = { name: name, frame: 0, acc: 0, loop: loop, onEnd: onEnd || null };
        draw();
        startLoop();
    }

    function draw() {
        if (!anim || !ctx) return;
        var a = meta.animations[anim.name];
        var fw = meta.frameWidth, fh = meta.frameHeight;
        ctx.clearRect(0, 0, fw, fh);
        ctx.drawImage(images[anim.name], anim.frame * fw, 0, fw, fh, 0, 0, fw, fh);
    }

    function fpsOf(name) {
        var fps = meta.animations[name].fps;
        return reducedMotion() ? fps / 2 : fps;
    }

    function tick(ts) {
        var dt = lastTs ? Math.min(100, ts - lastTs) : 0;
        lastTs = ts;
        var busy = false;
        if (anim) {
            var a = meta.animations[anim.name];
            anim.acc += dt;
            var step = 1000 / fpsOf(anim.name);
            var changed = false;
            while (anim && anim.acc >= step) {
                anim.acc -= step;
                if (anim.frame + 1 < a.frames) { anim.frame++; changed = true; }
                else if (anim.loop) { anim.frame = 0; changed = true; }
                else {
                    var cb = anim.onEnd;
                    anim.onEnd = null;
                    anim.acc = 0;
                    if (cb) { cb(); }
                    if (anim && anim.name !== a.name) { changed = true; a = meta.animations[anim.name]; }
                    break;
                }
            }
            if (changed) draw();
            busy = !!anim;
        }
        if (confettiFx) {
            if (confettiFx.step(dt)) busy = true;
            else confettiFx = null;
        }
        // rafId stays non-zero while ticking so play() → startLoop() can't double-schedule
        rafId = busy && layer && layer.parentNode ? global.requestAnimationFrame(tick) : 0;
    }

    function startLoop() {
        if (!rafId) { lastTs = 0; rafId = global.requestAnimationFrame(tick); }
    }

    function stopLoop() {
        if (rafId) global.cancelAnimationFrame(rafId);
        rafId = 0;
        anim = null;
    }

    // ── Confetti ──────────────────────────────────────────────────────────
    // Square "pixel" particles on a low-res canvas upscaled with pixelated rendering.
    function Confetti(host, cx, cy, options, onDone) {
        var o = assign({ count: 220, durationMs: 2600, pixel: 3, spread: 1 }, options);
        var cv = document.createElement('canvas');
        cv.className = 'nt-mascot-confetti';
        var px = o.pixel;
        var W = Math.ceil(global.innerWidth / px), H = Math.ceil(global.innerHeight / px);
        cv.width = W; cv.height = H;
        host.insertBefore(cv, host.firstChild);
        var c = cv.getContext('2d');
        var x0 = cx / px, y0 = cy / px;
        var unit = Math.min(W, H);        // scale speeds to the viewport
        var n = Math.min(o.count, Math.round(W * H / 250));
        var P = [];
        var sizeRoll = function () { var r = Math.random(); return r < 0.15 ? 3 : r < 0.6 ? 2 : 1; };
        for (var i = 0; i < n; i++) {
            var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5 * o.spread;
            var sp = unit * (0.55 + Math.random() * 0.75);
            P.push({
                x: x0 + (Math.random() - 0.5) * 6,
                y: y0 + (Math.random() - 0.5) * 6,
                vx: Math.cos(ang) * sp * (0.6 + Math.random() * 0.6),
                vy: Math.sin(ang) * sp,
                s: sizeRoll(),
                col: (Math.random() * PALETTE.length) | 0,
                ph: Math.random() * 6.28,
                fr: 6 + Math.random() * 10,       // flutter speed
                sway: 4 + Math.random() * 10,
            });
        }
        // Group by colour once so each frame needs only PALETTE.length fillStyle changes
        var groups = PALETTE.map(function () { return []; });
        for (i = 0; i < n; i++) groups[P[i].col].push(P[i]);
        var t = 0, done = false;
        var grav = unit * 1.3, drag = 2.2, termV = unit * 0.28;

        this.step = function (dt) {
            if (done) return false;
            var s = dt / 1000;
            t += dt;
            c.clearRect(0, 0, W, H);
            var life = t / o.durationMs;
            if (life >= 1) { this.stop(); return false; }
            // Stepped fade in the last 30% keeps the pixel look
            c.globalAlpha = life < 0.7 ? 1 : Math.ceil((1 - life) / 0.3 * 4) / 4;
            var k = Math.exp(-drag * s);
            for (var g = 0; g < groups.length; g++) {
                var arr = groups[g];
                if (!arr.length) continue;
                c.fillStyle = PALETTE[g];
                for (var j = 0; j < arr.length; j++) {
                    var p = arr[j];
                    p.vx *= k;
                    p.vy = p.vy * k + grav * s;
                    if (p.vy > termV) p.vy = termV;
                    p.ph += p.fr * s;
                    p.x += (p.vx + Math.sin(p.ph) * p.sway * (p.vy > 0 ? 1 : 0)) * s;
                    p.y += p.vy * s;
                    if (p.y > H + 4) continue;
                    // Flutter: flip between a full square and a thin sliver
                    var h = Math.cos(p.ph * 1.7) > -0.3 ? p.s : 1;
                    c.fillRect(Math.round(p.x), Math.round(p.y), p.s, h);
                }
            }
            return true;
        };
        this.stop = function () {
            if (done) return;
            done = true;
            if (cv.parentNode) cv.parentNode.removeChild(cv);
            if (onDone) onDone();
        };
    }

    function stopConfetti() {
        var fx = confettiFx;
        confettiFx = null;
        if (fx) fx.stop();
    }

    function startConfetti(cx, cy, options, onDone) {
        stopConfetti();
        if (reducedMotion()) { if (onDone) onDone(); return; }
        confettiFx = new Confetti(layer, cx, cy, options, onDone);
        startLoop();
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    function beginSession(container) {
        endSession(true);
        var s = { id: ++sessionSeq, timers: [], cleanup: [], resolve: null, container: container };
        s.promise = new Promise(function (res) { s.resolve = res; });
        session = s;
        mount();
        var onResize = function () { if (session === s) placeStage(container); };
        global.addEventListener('resize', onResize);
        s.cleanup.push(function () { global.removeEventListener('resize', onResize); });
        return s;
    }

    function endSession(immediate) {
        var s = session;
        if (!s) return;
        session = null;
        s.timers.forEach(clearTimeout);
        s.cleanup.forEach(function (f) { f(); });
        if (immediate) unmount();
        s.resolve();
    }

    function later(s, ms, fn) {
        s.timers.push(setTimeout(function () { if (session === s) fn(); }, ms));
    }

    function fadeOutAndEnd(s) {
        if (session !== s) return;
        if (reducedMotion()) { endSession(true); return; }
        layer.classList.add('nt-fade');
        s.timers.push(setTimeout(function () { if (session === s) endSession(true); }, FADE_MS));
    }

    // Plays the exit animation (if any) then removes everything.
    function leave(s) {
        if (session !== s || s.leaving) return;
        s.leaving = true;
        bubble.classList.remove('nt-show');
        if (meta.animations.exit && !reducedMotion()) {
            play('exit', false, function () { anim = null; endSession(true); });
        } else {
            fadeOutAndEnd(s);
        }
    }

    function requireReady() {
        if (!meta) throw new Error('Mascot: call Mascot.init() first');
    }

    // ── Public API ────────────────────────────────────────────────────────
    function greet(container, options) {
        requireReady();
        var o = assign({ text: opts.greetText, autoHideMs: opts.greetAutoHideMs, dismissOnClick: true }, options);
        var s = beginSession(container);
        placeStage(container);
        bubble.textContent = o.text || '';
        var showBubble = function () { if (o.text && session === s) bubble.classList.add('nt-show'); };
        var greetAnim = meta.animations.greet;
        if (greetAnim && !reducedMotion()) {
            play('greet', false, function () { play('idle', true); });
            later(s, (greetAnim.frames / greetAnim.fps) * 1000 * 0.3, showBubble);
        } else {
            play('idle', true);
            showBubble();
        }
        if (o.autoHideMs > 0) later(s, o.autoHideMs, function () { leave(s); });
        if (o.dismissOnClick) {
            // Listen on the document (capture) so the overlay never has to block clicks.
            var onDown = function () { leave(s); };
            var arm = setTimeout(function () { document.addEventListener('pointerdown', onDown, true); }, 250);
            s.cleanup.push(function () { clearTimeout(arm); document.removeEventListener('pointerdown', onDown, true); });
        }
        return s.promise;
    }

    function celebrate(container, options) {
        requireReady();
        var o = assign({ durationMs: opts.celebrateDurationMs, confetti: true, text: '' }, options);
        var s = beginSession(container);
        var c = placeStage(container);
        bubble.textContent = o.text || '';
        if (o.text) bubble.classList.add('nt-show');
        play('celebrate', true);
        if (o.confetti) {
            startConfetti(c.x, c.y, { durationMs: Math.min(o.durationMs, 3000) });
        }
        later(s, Math.max(0, o.durationMs - FADE_MS), function () { fadeOutAndEnd(s); });
        return s.promise;
    }

    function idle(container, options) {
        requireReady();
        var o = assign({ text: '' }, options);
        var s = beginSession(container);
        placeStage(container);
        bubble.textContent = o.text || '';
        if (o.text) bubble.classList.add('nt-show');
        play('idle', true);
        return s.promise;
    }

    function confetti(container, options) {
        requireReady();
        mount();
        var r = targetRect(container);
        return new Promise(function (res) {
            startConfetti(r.left + r.width / 2, r.top + r.height / 2, options, function () {
                setTimeout(function () {
                    if (!session && !confettiFx && layer.parentNode) unmount();
                }, 0);
                res();
            });
        });
    }

    function hide(options) {
        var s = session;
        if (!s) {
            if (layer && layer.parentNode) unmount();
            return Promise.resolve();
        }
        if (options && options.immediate) endSession(true);
        else leave(s);
        return s.promise;
    }

    var api = {
        init: init,
        greet: greet,
        celebrate: celebrate,
        idle: idle,
        confetti: confetti,
        hide: hide,
        get ready() { return !!meta; },
        get visible() { return !!session; },
    };
    return api;
})(typeof window !== 'undefined' ? window : globalThis);

export default Mascot
