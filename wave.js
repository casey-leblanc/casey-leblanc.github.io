/* A dotted terrain under the about page's heading: rows of dots in perspective, lifted by a slow
   travelling wave. Decorative only. Each time it comes into view it moves for about five seconds,
   then eases to a stop, at no more than 30fps. It holds still for reduced motion and when the home's
   "pause motion" is on, and stops while off screen. */
(() => {
    "use strict";

    const canvas = document.querySelector("[data-wave]");
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const signal = (getComputedStyle(document.documentElement).getPropertyValue("--signal").match(/oklch\(([^)]+)\)/) || [])[1];
    ctx.fillStyle = "#000";
    ctx.fillStyle = "oklch(0.5 0.1 140)";
    const oklchOk = ctx.fillStyle !== "#000000" && !!signal;
    const ink = (a) => (oklchOk ? `oklch(${signal.trim()} / ${a.toFixed(3)})` : `rgba(0,255,65,${a.toFixed(3)})`);

    const ROWS = 22;
    const RUN = 5; // seconds of motion each time it comes into view, before it settles
    const SETTLE = 1.5; // seconds to ease to a stop
    let W = 0;
    let H = 0;
    let dpr = 1;
    let t = 0;
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;
    let ran = 0; // seconds moved since it last came into view
    let paused = false;
    try {
        paused = localStorage.getItem("ring-motion") === "off";
    } catch (e) {
        /* storage blocked: motion stays on */
    }

    function resize() {
        const r = canvas.getBoundingClientRect();
        if (!r.width) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = r.width;
        H = r.height;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        if (!running) draw();
    }

    function draw() {
        if (!W) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const cols = Math.max(24, Math.round(W / 16));
        for (let r = 0; r < ROWS; r++) {
            const depth = r / (ROWS - 1); // 0 far, 1 near
            const spread = 0.55 + 0.9 * depth;
            const base = H * (0.2 + 0.72 * depth);
            const lift = 10 + 42 * depth;
            const size = 0.7 + 1.5 * depth;
            ctx.fillStyle = ink(0.2 + 0.62 * depth);
            for (let c = 0; c < cols; c++) {
                const u = c / (cols - 1) - 0.5;
                const x = W / 2 + u * W * spread;
                if (x < -4 || x > W + 4) continue;
                const h = Math.sin(c * 0.22 + t * 0.7 + r * 0.35) * Math.cos(r * 0.5 - t * 0.45) + 0.45 * Math.sin(u * 7 - t * 0.3);
                const y = base - h * lift;
                ctx.fillRect(x - size / 2, y - size / 2, size, size);
            }
        }
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        if (!last) last = now;
        const gap = now - last;
        if (gap < 1000 / 30 - 4) return; // slow terrain looks the same at 30fps
        last = now;
        const dt = Math.min(0.05, gap / 1000);
        ran += dt;
        // after its run, the wave slows to a stop
        const speed = ran < RUN ? 1 : Math.max(0, 1 - (ran - RUN) / SETTLE);
        t += dt * speed;
        draw();
        if (!speed) stop();
    }

    function start() {
        if (running || reduce.matches || paused || !visible || document.hidden || ran >= RUN + SETTLE) return;
        running = true;
        last = 0;
        raf = requestAnimationFrame(frame);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(raf);
    }

    if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
            const was = visible;
            visible = entries[entries.length - 1].isIntersecting;
            if (visible && !was) ran = 0; // back in view: a fresh run
            if (visible) start();
            else stop();
        }).observe(canvas);
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    if (reduce.addEventListener) reduce.addEventListener("change", () => (reduce.matches ? (stop(), draw()) : start()));
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);

    resize();
    start();
})();
