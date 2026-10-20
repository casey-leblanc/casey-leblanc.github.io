/* A dotted terrain under the about page's heading: rows of dots in perspective, lifted by a slow
   travelling wave. Decorative only; it holds still for reduced motion and stops while off screen. */
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
    let W = 0;
    let H = 0;
    let dpr = 1;
    let t = 0;
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;

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
        t += Math.min(0.05, (now - last) / 1000);
        last = now;
        draw();
    }

    function start() {
        if (running || reduce.matches || !visible || document.hidden) return;
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
            visible = entries[entries.length - 1].isIntersecting;
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
