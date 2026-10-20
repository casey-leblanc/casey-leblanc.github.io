// Blog page behavior. The posts and the outline are compiled into the page by
// tools/blog.py, so this file only does progressive enhancement: it marks which
// post you're reading in the "jump to" list and keeps that item in view.
(function () {
    const links = Array.from(document.querySelectorAll(".outline-link"));
    const posts = Array.from(document.querySelectorAll(".post"));
    if (!links.length || !posts.length || !("IntersectionObserver" in window)) return;

    const list = document.querySelector(".outline-list");
    const byId = new Map(links.map((link) => [link.dataset.postId, link]));

    function setCurrent(id) {
        const active = byId.get(id);
        if (!active || active.getAttribute("aria-current") === "true") return;
        links.forEach((link) => link.removeAttribute("aria-current"));
        active.setAttribute("aria-current", "true");

        // On small screens the list scrolls sideways; keep the current chip visible.
        if (list && list.scrollWidth > list.clientWidth) {
            const target = active.parentElement.offsetLeft - list.offsetLeft;
            list.scrollTo({ left: Math.max(0, target - 12), behavior: "auto" });
        }
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) setCurrent(entry.target.id);
            });
        },
        { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    posts.forEach((post) => observer.observe(post));

    if (location.hash) setCurrent(location.hash.slice(1));
    links.forEach((link) => link.addEventListener("click", () => setCurrent(link.dataset.postId)));
})();
