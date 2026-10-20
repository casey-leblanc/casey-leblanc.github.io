/* Inner pages: the readout prints itself in.
   On arrival a scan line crosses the page title as it appears (the blog's title is typed out
   instead, behind a blinking block cursor), then the statement or intro lights
   up word by word, left to right, each word flashing signal green and cooling to its own colour.
   Further down, each section's rule draws out from its tick as it scrolls in, its title prints,
   and its rows wipe in as a list. Blog post text stays still, for reading.

   Runs only when the head script set .motion (motion allowed and scripts on). Everything is
   visible without it, and the head script drops .motion if this file never says it is ready. */
(() => {
    "use strict";

    const root = document.documentElement;
    if (!root.classList.contains("motion")) return;

    const LINE = 85; // ms between the lines of a printed paragraph
    const SWEEP = 240; // ms for the print to cross one line
    const WORD = 560; // ms each word takes to light up and cool
    const ITEM = 70; // ms between the items of a list
    const CAP = 6; // items after this many share the last delay

    // the parts that get revealed, each with a way of arriving
    const GROUPS = ".page-head, main > .wave, .planner-shot, .showcase, .section, .outline, .post, .pdf-frame, .resume-summary";
    const PARTS = [
        [".page-title", "title"],
        [".section-title, .summary-title", "heading"],
        [".statement, .page-intro", "lines"],
        [".rows > li, .facts > .fact, .link-list > li, .outline-list > li, .post-head", "item"],
        [".actions, .page-note, .more, .contact-mail", "block"],
    ];
    const SELECTOR = PARTS.map(([s]) => s).join(", ");
    const kindOf = (el) => PARTS.find(([s]) => el.matches(s))[1];

    let nextFree = 0; // groups revealed together queue up behind each other instead of all at once

    /* ---------- the ways of arriving ---------- */

    // a title: revealed behind a scan line (page titles) or without one (section titles)
    function title(el, at, scan) {
        const ink = document.createElement("span");
        ink.className = "ink";
        ink.append(...el.childNodes);
        el.append(ink);
        let bar = null;
        if (scan) {
            bar = document.createElement("span");
            bar.className = "scan";
            bar.setAttribute("aria-hidden", "true");
            el.append(bar);
            el.style.setProperty("--ink-w", `${ink.offsetWidth}px`);
        }
        el.style.setProperty("--d", `${at}ms`);
        el.classList.add("is-in");
        return [at + 160, () => {
            if (bar) bar.remove();
            el.replaceChildren(...ink.childNodes);
        }];
    }

    // a title marked data-typewriter (the blog's): typed out a key at a time behind a block cursor,
    // which blinks a few times once the word is done and then goes
    function typewriter(el, at) {
        const text = el.textContent.trim();
        const keys = document.createElement("span");
        keys.setAttribute("aria-hidden", "true");
        const caret = document.createElement("span");
        caret.className = "caret";
        caret.setAttribute("aria-hidden", "true");
        el.setAttribute("aria-label", text);
        el.replaceChildren(keys, caret);
        el.classList.add("is-in");

        setTimeout(() => caret.classList.add("is-on"), at);
        let t = at + 260; // a beat before the first key, like someone about to type
        for (const ch of text) {
            setTimeout(() => keys.append(ch), t);
            t += 85 + Math.random() * 70; // uneven, like real typing
        }
        setTimeout(() => caret.classList.add("is-idle"), t);
        const gone = t + 3 * 1050; // three blinks
        setTimeout(() => caret.classList.remove("is-on", "is-idle"), gone);
        return [t + 80, () => {
            el.textContent = text;
            el.removeAttribute("aria-label");
        }, gone + 300];
    }

    // a paragraph: each word lights up in reading order, a line at a time
    function lines(el, at) {
        const original = el.innerHTML;
        const words = [];
        (function wrap(node) {
            for (const child of [...node.childNodes]) {
                if (child.nodeType === 1) {
                    wrap(child);
                    continue;
                }
                if (child.nodeType !== 3) continue;
                const frag = document.createDocumentFragment();
                for (const part of child.textContent.split(/(\s+)/)) {
                    if (!part) continue;
                    if (/^\s+$/.test(part)) {
                        frag.append(part);
                        continue;
                    }
                    const w = document.createElement("span");
                    w.className = "w";
                    w.textContent = part;
                    frag.append(w);
                    words.push(w);
                }
                child.replaceWith(frag);
            }
        })(el);

        // group the words into lines by where they sit, then time each by line and by how far along it is
        const box = el.getBoundingClientRect();
        const rects = words.map((w) => w.getBoundingClientRect());
        const tops = [];
        rects.forEach((r) => {
            if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2)) tops.push(r.top);
        });
        tops.sort((a, b) => a - b);
        const step = tops.length > 6 ? (6 * LINE) / tops.length : LINE;
        let end = at;
        words.forEach((w, i) => {
            const r = rects[i];
            const line = tops.findIndex((t) => Math.abs(t - r.top) < r.height / 2);
            const along = box.width ? (r.left - box.left) / box.width : 0;
            const d = Math.round(at + line * step + along * SWEEP);
            w.style.setProperty("--d", `${d}ms`);
            end = Math.max(end, d);
        });
        el.classList.add("is-in");
        return [at + Math.min(end - at, 700) * 0.6, () => (el.innerHTML = original), end + WORD];
    }

    // a list item or a block: wiped in, or lifted in
    function arrive(el, at) {
        el.style.setProperty("--d", `${at}ms`);
        el.classList.add("is-in");
        return [at + 120, null];
    }

    /* ---------- revealing a group ---------- */

    function reveal(group) {
        if (group.dataset.printed) return;
        group.dataset.printed = "";
        const now = performance.now();
        // a post's text never hides, so its head can't wait in the queue behind the page title
        let at = group.matches(".post, .outline") ? 120 : Math.max(0, nextFree - now);
        const start = at;
        const tidy = [];
        let last = at + 700;

        if (!group.querySelector(SELECTOR) && !group.matches(".section, .post, .outline, .resume-summary")) {
            // a picture or a canvas on its own
            group.style.setProperty("--d", `${at}ms`);
            group.classList.add("is-in");
            at += 160;
        } else {
            group.classList.add("is-in"); // sections draw their rule
            if (group.matches(".section")) at += 120;
            let list = null;
            let n = 0;
            for (const el of group.querySelectorAll(SELECTOR)) {
                const kind = kindOf(el);
                if (kind === "item") {
                    // items of one list arrive as a list, the stagger capped
                    if (el.parentElement !== list) {
                        list = el.parentElement;
                        n = 0;
                    }
                    arrive(el, at + Math.min(n, CAP) * ITEM);
                    n++;
                    last = Math.max(last, at + Math.min(n, CAP) * ITEM + 700);
                    continue;
                }
                if (list) {
                    at += Math.min(n, CAP) * ITEM + 80;
                    list = null;
                }
                let res;
                if (kind === "title" && el.hasAttribute("data-typewriter")) res = typewriter(el, at);
                else if (kind === "title") res = title(el, at, true);
                else if (kind === "heading") res = title(el, at, false);
                else if (kind === "lines") res = lines(el, at);
                else res = arrive(el, at);
                at = res[0];
                if (res[1]) tidy.push(res[1]);
                last = Math.max(last, res[2] || at + 700);
            }
            if (list) at += Math.min(n, CAP) * ITEM;
        }
        nextFree = now + start + Math.max(160, (at - start) * 0.5);
        // once everything has arrived, put the markup back the way it was
        if (tidy.length) setTimeout(() => tidy.forEach((fn) => fn()), last + 120);
    }

    try {
        const groups = [...document.querySelectorAll(GROUPS)];
        root.classList.add("motion-ready");
        if (!("IntersectionObserver" in window)) {
            groups.forEach(reveal);
            return;
        }
        const head = groups.find((g) => g.matches(".page-head"));
        if (head) reveal(head);
        const io = new IntersectionObserver(
            (entries) => {
                entries
                    .filter((e) => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                    .forEach((e) => {
                        io.unobserve(e.target);
                        reveal(e.target);
                    });
            },
            { rootMargin: "0px 0px -8% 0px" }
        );
        groups.filter((g) => g !== head).forEach((g) => io.observe(g));
    } catch (err) {
        // never leave the page hidden
        root.classList.remove("motion");
        throw err;
    }
})();
