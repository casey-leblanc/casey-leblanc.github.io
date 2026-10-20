/* The home menu's ring: a woven string-art torus drawn on a canvas.
   Each of N triangles has one corner on an inner circle and two on an outer one; rotated copies
   weave into a ring. It breathes slowly, bends and brightens toward the pointer, and lights the
   side facing a hovered menu label. Choosing a label unravels it: the weave spins apart into a
   star, the strings drop out, the dial spins away and the name's letters scatter, then the page
   changes. Coming back to the menu plays that in reverse: the ring weaves itself back together and
   the letters gather. Reduced motion, or the motion toggle, holds it still. An inline SVG of the
   same ring stands in until this runs.

   Kept light on purpose, since a full-screen canvas redrawn every frame adds up fast:
   - Lines are hairlines, one device pixel wide and brightened to match, which the GPU draws on a
     fast path; wider strokes were what made the ring lag.
   - Lines are batched by brightness, so a frame is a few dozen strokes rather than hundreds.
   - The canvas covers only the ring. Idle breathing runs at 30fps, and nothing goes above 60.
   - If frames still arrive late, the canvas drops its resolution, then its frame rate. */
(() => {
    "use strict";

    const stage = document.querySelector("[data-ring]");
    if (!stage) return;
    const box = stage.querySelector(".ring");
    const canvas = box && box.querySelector("canvas");
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const TAU = Math.PI * 2;
    const N = 128; // woven triangles
    const TICKS = 120; // dial ticks outside the ring
    const INNER = 0.52; // inner radius as a share of the outer one
    const STEPS = 33; // brightness steps from 0 to 1; lines are batched by step
    const GROUPS = 4; // each step is split into interleaved strokes so crossing lines still add up
    const EXIT_MS = 560; // how long the ring unravels before the page changes
    const RETURN_MS = 900; // how long it takes to weave back together when you come back to the menu

    // quality, best first; the governor steps down when frames keep arriving late
    const QUALITY = [
        { dpr: 2, fps: 60 },
        { dpr: 1.5, fps: 60 },
        { dpr: 1, fps: 60 },
        { dpr: 1, fps: 30 },
    ];

    // the page's own signal colour, so the canvas and the CSS green are the same green
    ctx.strokeStyle = "#00ff41";
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#00ff41";
    const INK = ctx.strokeStyle;

    const view = { cw: 0, ch: 0, dpr: 1, cx: 0, cy: 0, ro: 0, ri: 0 };
    const bend = { a: 0, k: 0, ta: 0, tk: 0 }; // the pointer's pull
    const sector = { a: Math.PI, k: 0, ta: Math.PI, tk: 0 }; // the hovered label's side
    const tri = new Float32Array(N * 6);
    const triStep = new Uint8Array(N);
    const tick = new Float32Array(TICKS * 4);
    const tickStep = new Uint8Array(TICKS);
    const count = new Uint16Array(STEPS);
    let t = 0;
    let intro = 0; // 0..1 while the ring draws itself in
    let running = false;
    let leaving = 0; // the timer that changes page once the ring has unravelled
    let exit = 0; // 0..1 while it unravels, and back down to 0 while it weaves back
    let returning = false; // weaving back together
    let gathered = 0; // the timer that tidies up after the return
    let raf = 0;
    let last = 0;
    let lively = 0; // until this time, draw at the full rate: the pointer or a label is moving the ring
    let q = 0; // index into QUALITY
    let late = 1; // smoothed ratio of actual to intended frame spacing
    let judged = 0; // frames counted since the quality last changed

    const toggle = stage.querySelector("[data-motion-toggle]");
    let paused = false;
    try {
        paused = localStorage.getItem("ring-motion") === "off";
        q = clamp(parseInt(sessionStorage.getItem("ring-quality"), 10) || 0, 0, QUALITY.length - 1);
    } catch (e) {
        /* storage blocked: motion stays on, quality starts at the top */
    }

    function clamp(v, a, b) {
        return Math.min(b, Math.max(a, v));
    }
    const angDiff = (a, b) => {
        let d = (a - b) % TAU;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        return d;
    };
    const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
    const easeIn = (x) => Math.pow(clamp(x, 0, 1), 2.2);
    const scatter = (i) => ((i * 37) % 64) / 64; // a fixed, shuffled 0..1 per index, so strings drop out in no visible order
    const stepOf = (a) => clamp(Math.round(a * (STEPS - 1)), 0, STEPS - 1);
    const quality = (i) => ({ dpr: Math.min(window.devicePixelRatio || 1, QUALITY[i].dpr), fps: QUALITY[i].fps });

    // the backing store, at the current quality
    function fit() {
        view.dpr = quality(q).dpr;
        canvas.width = Math.round(view.cw * view.dpr);
        canvas.height = Math.round(view.ch * view.dpr);
    }

    function resize() {
        const r = box.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const css = getComputedStyle(stage);
        const zone = parseFloat(css.getPropertyValue("--label-px")) || 0;
        const fill = parseFloat(css.getPropertyValue("--ring-fill")) || 0.46; // smaller on desktop, to clear the top and bottom lines
        view.cx = r.width / 2;
        view.cy = r.height / 2;
        view.ro = Math.max(40, Math.min(r.height * fill, (r.width - 2 * zone) * 0.45));
        view.ri = view.ro * INNER;
        // the canvas covers the ring at its furthest bend and unravel, and the dial, rather than the whole stage
        const reach = Math.ceil(Math.max(view.ro * 1.31, view.ro * 1.17 + 10)) + 2;
        view.cw = Math.min(r.width, 2 * reach);
        view.ch = Math.min(r.height, 2 * reach);
        canvas.style.width = `${view.cw}px`;
        canvas.style.height = `${view.ch}px`;
        fit();
        // the name sizes itself to the hole
        stage.style.setProperty("--hole", `${Math.round(view.ri * 2)}px`);
        if (!running) draw();
    }

    function draw() {
        const { cw, ch, dpr, ro, ri } = view;
        if (!cw) return;
        const cx = cw / 2;
        const cy = ch / 2;
        const u = easeIn(exit); // the unravel: inner corners spin and pull in, outer ones fan apart
        const rot = t * 0.045;
        const twist = 0.55 + 0.25 * Math.sin(t * 0.23) + 2.4 * u;
        const spread = 0.42 + 0.06 * Math.sin(t * 0.17 + 1) + 0.55 * u;
        const drawn = intro >= 1 ? 1 : easeOut(intro);
        const shown = Math.floor(drawn * N);
        count.fill(0);

        for (let i = 0; i < N; i++) {
            if (i >= shown) {
                triStep[i] = 0;
                continue;
            }
            const a = (i / N) * TAU - Math.PI / 2 + rot;
            const db = angDiff(a, bend.a);
            const ds = angDiff(a, sector.a);
            const wb = bend.k * Math.exp(-(db * db) / 0.25);
            const ws = sector.k * Math.exp(-(ds * ds) / 0.18);
            const breathe = 0.035 * Math.sin(a * 3 - t * 0.6);
            const o = ro * (1 + breathe + 0.07 * wb + 0.06 * ws) * (1 + 0.12 * u);
            const n = ri * (1 - 0.5 * breathe - 0.05 * wb) * (1 - 0.6 * u);
            const j = i * 6;
            tri[j] = cx + n * Math.cos(a + twist);
            tri[j + 1] = cy + n * Math.sin(a + twist);
            tri[j + 2] = cx + o * Math.cos(a - spread);
            tri[j + 3] = cy + o * Math.sin(a - spread);
            tri[j + 4] = cx + o * Math.cos(a + spread);
            tri[j + 5] = cy + o * Math.sin(a + spread);
            // the newest triangles fade in as the intro sweeps round
            const fresh = intro >= 1 ? 1 : clamp((drawn * N - i) / 12, 0, 1);
            // while it unravels, each string lets go at its own moment
            const held = exit ? clamp((1 - exit) * 1.6 - scatter(i) * 0.6, 0, 1) : 1;
            const s = stepOf((0.22 + 0.5 * Math.max(wb, ws)) * fresh * held);
            triStep[i] = s;
            count[s]++;
        }

        // the dial: ticks just outside the ring, turning the other way, longer every tenth
        const dial = ro * (1.07 + 0.1 * u);
        for (let k = 0; k < TICKS; k++) {
            if (k / TICKS > drawn) {
                tickStep[k] = 0;
                continue;
            }
            const a = (k / TICKS) * TAU - rot * 0.6 - 3 * u;
            const major = k % 10 === 0;
            const lit = Math.max(sector.k * Math.exp(-(angDiff(a, sector.a) ** 2) / 0.05), bend.k * Math.exp(-(angDiff(a, bend.a) ** 2) / 0.05));
            const len = major ? 9 : 4;
            const c = Math.cos(a);
            const sn = Math.sin(a);
            const j = k * 4;
            tick[j] = cx + dial * c;
            tick[j + 1] = cy + dial * sn;
            tick[j + 2] = cx + (dial + len) * c;
            tick[j + 3] = cy + (dial + len) * sn;
            const s = stepOf(((major ? 0.5 : 0.24) + 0.5 * lit) * (1 - u));
            tickStep[k] = s;
            count[s]++;
        }
        // a hairline circle inside the hole
        const hole = stepOf(0.16 * (1 - u));
        const holeR = ri * 0.93 * (1 - 0.4 * u);
        count[hole]++;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        // one device pixel wide, brightened by the pixel ratio so it reads like a 1px line
        ctx.lineWidth = 1 / dpr;
        ctx.lineJoin = "bevel";
        ctx.strokeStyle = INK;
        ctx.globalCompositeOperation = "lighter";
        for (let s = 1; s < STEPS; s++) {
            if (!count[s]) continue;
            ctx.globalAlpha = Math.min(1, (s / (STEPS - 1)) * dpr);
            for (let g = 0; g < GROUPS; g++) {
                ctx.beginPath();
                for (let i = g; i < N; i += GROUPS) {
                    if (triStep[i] !== s) continue;
                    const j = i * 6;
                    ctx.moveTo(tri[j], tri[j + 1]);
                    ctx.lineTo(tri[j + 2], tri[j + 3]);
                    ctx.lineTo(tri[j + 4], tri[j + 5]);
                    ctx.closePath();
                }
                if (g === 0) {
                    for (let k = 0; k < TICKS; k++) {
                        if (tickStep[k] !== s) continue;
                        const j = k * 4;
                        ctx.moveTo(tick[j], tick[j + 1]);
                        ctx.lineTo(tick[j + 2], tick[j + 3]);
                    }
                    if (s === hole) {
                        ctx.moveTo(cx + holeR, cy);
                        ctx.arc(cx, cy, holeR, 0, TAU);
                    }
                }
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }

    // one step down the quality list, skipping steps that change nothing on this screen
    function lower() {
        const was = quality(q);
        while (q < QUALITY.length - 1) {
            q++;
            const next = quality(q);
            if (next.dpr !== was.dpr || next.fps !== was.fps) break;
        }
        try {
            sessionStorage.setItem("ring-quality", String(q));
        } catch (e) {
            /* storage blocked: this visit only */
        }
        if (quality(q).dpr !== was.dpr) fit();
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        if (!last) last = now;
        const gap = now - last;
        // slow breathing looks the same at 30fps; the pointer, a label or the intro get up to 60
        const fps = Math.min(quality(q).fps, intro >= 1 && now > lively ? 30 : 60);
        if (gap < 1000 / fps - 4) return;
        last = now;

        // frames that keep arriving well after they were due mean this machine needs a lighter ring
        if (gap > 0 && gap < 250) {
            late = late * 0.92 + ((gap * fps) / 1000) * 0.08;
            if (++judged > 30 && late > 1.4 && q < QUALITY.length - 1) {
                lower();
                late = 1;
                judged = 0;
            }
        }

        const dt = Math.min(0.05, gap / 1000);
        t += dt;
        intro = Math.min(1, intro + dt / 1.6);
        bend.k += (bend.tk - bend.k) * (1 - Math.exp(-dt * 5));
        bend.a += angDiff(bend.ta, bend.a) * (1 - Math.exp(-dt * 8));
        sector.k += (sector.tk - sector.k) * (1 - Math.exp(-dt * 7));
        sector.a += angDiff(sector.ta, sector.a) * (1 - Math.exp(-dt * 10));
        if (leaving) exit = Math.min(1, exit + dt / (EXIT_MS / 1000));
        else if (returning) {
            exit = Math.max(0, exit - dt / (RETURN_MS / 1000));
            if (!exit) returning = false;
        }
        draw();
    }

    const still = () => reduce.matches || paused;
    const wake = () => (lively = performance.now() + 600);

    function start() {
        if (running || leaving || still() || document.hidden) return;
        running = true;
        last = 0;
        judged = 0;
        raf = requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    function hold() {
        stop();
        intro = 1;
        draw();
    }

    function syncToggle() {
        if (!toggle) return;
        toggle.hidden = reduce.matches;
        toggle.textContent = paused ? "resume motion" : "pause motion";
    }

    if (toggle) {
        toggle.addEventListener("click", () => {
            paused = !paused;
            try {
                localStorage.setItem("ring-motion", paused ? "off" : "on");
            } catch (e) {
                /* storage blocked: the choice lasts for this visit */
            }
            syncToggle();
            if (paused) hold();
            else start();
        });
    }

    /* ---------- the pointer pulls the ring ---------- */

    window.addEventListener("pointermove", (e) => {
        const r = box.getBoundingClientRect();
        const x = e.clientX - r.left - view.cx;
        const y = e.clientY - r.top - view.cy;
        const d = Math.hypot(x, y);
        bend.ta = Math.atan2(y, x);
        bend.tk = clamp(1 - Math.abs(d - (view.ro + view.ri) / 2) / (view.ro * 0.9), 0, 1);
        wake();
        if (!running && !still()) start();
    });
    document.documentElement.addEventListener("pointerleave", () => {
        bend.tk = 0;
        wake();
    });

    /* ---------- leaving: the name's letters scatter as the ring unravels ---------- */

    const nameEl = stage.querySelector(".who-name");

    function scatterName() {
        if (!nameEl || nameEl.dataset.text) return;
        const text = nameEl.textContent.trim();
        const box0 = nameEl.getBoundingClientRect();
        nameEl.dataset.text = text;
        nameEl.setAttribute("aria-label", text);
        const letters = document.createElement("span");
        letters.setAttribute("aria-hidden", "true");
        // letters sit inside unbreakable words, so the name still breaks only between words
        text.split(" ").forEach((part, w) => {
            if (w) letters.append(" ");
            const word = document.createElement("span");
            word.className = "word";
            for (const ch of part) {
                const span = document.createElement("span");
                span.className = "ch";
                span.textContent = ch;
                word.append(span);
            }
            letters.append(word);
        });
        nameEl.replaceChildren(letters);
        // each letter flies away from the middle of the name, a little rotated
        const mx = box0.left + box0.width / 2;
        const my = box0.top + box0.height / 2;
        letters.querySelectorAll(".ch").forEach((span, i) => {
            const r = span.getBoundingClientRect();
            const dx = r.left + r.width / 2 - mx;
            const dy = r.top + r.height / 2 - my || 1;
            const d = Math.hypot(dx, dy);
            const far = 70 + scatter(i * 3) * 60;
            span.style.setProperty("--dx", `${((dx / d) * far).toFixed(1)}px`);
            span.style.setProperty("--dy", `${((dy / d) * far).toFixed(1)}px`);
            span.style.setProperty("--r", `${Math.round(scatter(i * 5) * 70 - 35)}deg`);
            span.style.transitionDelay = `${Math.round(scatter(i * 7) * 120)}ms`;
        });
        void nameEl.offsetWidth; // settle the letters where they start before anything moves them
    }

    function gatherName() {
        if (!nameEl || !nameEl.dataset.text) return;
        nameEl.textContent = nameEl.dataset.text;
        nameEl.removeAttribute("aria-label");
        delete nameEl.dataset.text;
    }

    /* ---------- coming back: the ring weaves itself back together and the letters gather ---------- */

    // from wherever the ring is (fully unravelled on arrival, or as it was left, after the back button)
    function weaveBack() {
        intro = 1;
        exit = Math.max(exit, 0.999);
        returning = true;
        lively = performance.now() + RETURN_MS + 400;
        scatterName(); // splits the name, if it is not split already, with the letters where they would fly to
        requestAnimationFrame(() => {
            stage.classList.add("is-gathering");
            stage.classList.remove("is-leaving");
            document.documentElement.classList.remove("menu-return");
        });
        clearTimeout(gathered);
        gathered = setTimeout(() => {
            stage.classList.remove("is-gathering");
            gatherName();
        }, RETURN_MS + 500);
    }

    /* ---------- a hovered or focused label lights the side of the ring facing it ---------- */

    stage.querySelectorAll("[data-sector]").forEach((link) => {
        const on = () => {
            const deg = parseFloat(link.dataset.sector);
            const r = box.getBoundingClientRect();
            const l = link.getBoundingClientRect();
            // aim at the label itself when it sits beside the ring; fall back to its stated side
            const x = l.left + l.width / 2 - r.left - view.cx;
            const y = l.top + l.height / 2 - r.top - view.cy;
            sector.ta = Math.hypot(x, y) > view.ro * 0.9 ? Math.atan2(y, x) : (deg * Math.PI) / 180;
            sector.tk = 1;
            wake();
            if (still()) {
                sector.a = sector.ta;
                sector.k = 1;
                draw();
            }
        };
        const off = () => {
            sector.tk = 0;
            wake();
            if (still()) {
                sector.k = 0;
                draw();
            }
        };
        link.addEventListener("pointerenter", on);
        link.addEventListener("focus", on);
        link.addEventListener("pointerleave", off);
        link.addEventListener("blur", off);

        // choosing a label unravels the ring and scatters the name, then the page changes
        link.addEventListener("click", (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (link.target === "_blank" || still() || !running) return;
            e.preventDefault();
            if (leaving) return;
            lively = performance.now() + EXIT_MS + 500;
            scatterName();
            // one frame later, so the letters start from where they stand
            requestAnimationFrame(() => stage.classList.add("is-leaving"));
            leaving = setTimeout(() => {
                window.location.href = link.href;
            }, EXIT_MS);
        });
    });

    // coming back through the back button to the page as it was left: weave it back together
    window.addEventListener("pageshow", (e) => {
        if (!e.persisted) return;
        clearTimeout(leaving);
        leaving = 0;
        if (still()) {
            exit = 0;
            gatherName();
            stage.classList.remove("is-leaving");
            hold();
            return;
        }
        if (stage.classList.contains("is-leaving")) weaveBack();
        start();
    });

    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    if (reduce.addEventListener) {
        reduce.addEventListener("change", () => {
            syncToggle();
            if (still()) hold();
            else start();
        });
    }
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(box);
    else window.addEventListener("resize", resize);

    stage.classList.add("is-live");
    syncToggle();
    // the head script sets .menu-return when you arrive from another page of the site
    const back = document.documentElement.classList.contains("menu-return") && !still();
    if (back) exit = 1; // so even the first frame starts unravelled
    resize();
    if (still()) {
        document.documentElement.classList.remove("menu-return");
        hold();
    } else {
        if (back) weaveBack();
        start();
    }
})();
