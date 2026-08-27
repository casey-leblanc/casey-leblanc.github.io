document.addEventListener("DOMContentLoaded", () => {
    const postsContainer = document.getElementById("blog-posts");
    if (!postsContainer) return;

    // Default post paths to check
    const postFiles = [
        "../posts/2026-08-26-post1.md",
        "../posts/2026-08-25-1.md",
        "../posts/2026-08-23-building-my-website.md",
        "../posts/2026-08-15-hello-world.md"
    ];


    loadBlogPosts();

    async function loadBlogPosts() {
        let rawPosts = [];

        try {
            // Try fetching posts.json first, or fallback to postFiles list
            let fileList = postFiles;
            try {
                const listRes = await fetch("../posts/posts.json");
                if (listRes.ok) {
                    const jsonList = await listRes.json();
                    fileList = jsonList.map(file => file.startsWith("../") ? file : `../${file}`);
                }
            } catch (e) {
                // posts.json fetch failed, using default list
            }

            // Fetch each markdown file
            const fetchPromises = fileList.map(async (file) => {
                const res = await fetch(file);
                if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                const text = await res.text();
                return { filename: file, markdown: text };
            });

            rawPosts = await Promise.all(fetchPromises);
        } catch (err) {
            console.warn("fetch failed (possibly file:// protocol restriction)", err);
        }

        // Parse frontmatter and content for all posts
        const parsedPosts = rawPosts.map((post) => {
            const { metadata, content } = parseFrontmatter(post.markdown);
            const title = (metadata.title || extractTitle(content) || post.filename).toLowerCase();
            const date = metadata.date || "undated";
            return {
                title,
                date,
                rawDate: date,
                content,
                html: parseMarkdown(content)
            };
        });

        // Sort posts descending by date (newest at the top)
        parsedPosts.sort((a, b) => {
            const dateA = new Date(a.rawDate);
            const dateB = new Date(b.rawDate);
            if (isNaN(dateA) || isNaN(dateB)) return 0;
            return dateB - dateA;
        });

        // Assign IDs after sorting
        parsedPosts.forEach((post, index) => {
            post.id = createPostSlug(post, index);
        });

        // Render posts and outline
        renderPosts(parsedPosts);
        renderOutline(parsedPosts);
        setupOutlineObserver();

        // If URL has a hash, scroll smoothly to the post
        if (window.location.hash) {
            const targetId = window.location.hash.substring(1);
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                setTimeout(() => {
                    targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActiveOutlineItem(targetId);
                }, 150);
            }
        }
    }

    function createPostSlug(post, index) {
        const cleanTitle = (post.title || "")
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();
        const cleanDate = (post.rawDate || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        if (cleanDate && cleanTitle) {
            return `post-${cleanDate}-${cleanTitle}`;
        } else if (cleanTitle) {
            return `post-${cleanTitle}`;
        }
        return `post-${index + 1}`;
    }

    function parseFrontmatter(text) {
        let metadata = {};
        let content = text.trim();

        if (text.startsWith("---")) {
            const endIdx = text.indexOf("---", 3);
            if (endIdx !== -1) {
                const frontmatterStr = text.substring(3, endIdx).trim();
                content = text.substring(endIdx + 3).trim();

                const lines = frontmatterStr.split("\n");
                lines.forEach((line) => {
                    const colonIdx = line.indexOf(":");
                    if (colonIdx !== -1) {
                        const key = line.substring(0, colonIdx).trim().toLowerCase();
                        const val = line.substring(colonIdx + 1).trim();
                        metadata[key] = val;
                    }
                });
            }
        }
        return { metadata, content };
    }

    function extractTitle(content) {
        const match = content.match(/^#\s+(.+)$/m);
        return match ? match[1] : null;
    }

    function formatDate(dateStr) {
        if (!dateStr || dateStr === "undated") return "";
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) return dateStr.toLowerCase();
        
        const options = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC"};
        // Format to lowercase date string
        return parsed.toLocaleDateString("en-US", options).toLowerCase();
    }

    function parseMarkdown(md) {
        if (!md) return "";

        let html = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // Fenced code blocks
        html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<code>${escaped}</code>`;
        });

        // Blockquotes
        html = html.replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

        // Headings (#### to #)
        html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Horizontal rules
        html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr>');

        // Bold & Italic
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
        html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Unordered lists
        html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '<ul><li>$1</li></ul>');
        html = html.replace(/<\/ul>\n<ul>/g, '');

        // Ordered lists
        html = html.replace(/^\s*\d+\.\s+(.*)$/gm, '<ol><li>$1</li></ol>');
        html = html.replace(/<\/ol>\n<ol>/g, '');

        // Paragraphs
        const blocks = html.split(/\n{2,}/);
        html = blocks.map(block => {
            block = block.trim();
            if (!block) return "";
            if (/^(<h[1-6]|<ul|<ol|<pre|<blockquote|<hr)/i.test(block)) {
                return block;
            }
            return `<p>${block.replace(/\n/g, "<br>")}</p>`;
        }).filter(Boolean).join("\n");

        return html;
    }

    function renderPosts(posts) {
        postsContainer.innerHTML = "";

        if (posts.length === 0) {
            postsContainer.innerHTML = `<p class="no-posts">no blog entries found.</p>`;
            return;
        }

        posts.forEach(post => {
            const entry = document.createElement("article");
            entry.className = "blog-entry";
            entry.id = post.id;

            const header = document.createElement("div");
            header.className = "blog-entry-header";

            const title = document.createElement("h2");
            title.className = "blog-entry-title";
            title.textContent = post.title;

            const date = document.createElement("span");
            date.className = "blog-entry-date";
            date.textContent = formatDate(post.date);

            header.appendChild(title);
            header.appendChild(date);

            const content = document.createElement("div");
            content.className = "blog-entry-content";
            content.innerHTML = post.html;

            entry.appendChild(header);
            entry.appendChild(content);

            postsContainer.appendChild(entry);
        });
    }

    function renderOutline(posts) {
        const outlineContainer = document.getElementById("blog-outline");
        if (!outlineContainer) return;

        outlineContainer.innerHTML = "";

        if (posts.length === 0) {
            outlineContainer.innerHTML = `<span class="outline-empty">no posts found</span>`;
            return;
        }

        posts.forEach((post, index) => {
            const item = document.createElement("a");
            item.href = `#${post.id}`;
            item.className = "outline-item";
            item.dataset.postId = post.id;
            if (index === 0) item.classList.add("active");

            const title = document.createElement("span");
            title.className = "outline-item-title";
            title.textContent = post.title;

            const date = document.createElement("span");
            date.className = "outline-item-date";
            date.textContent = formatDate(post.date);

            item.appendChild(title);
            if (post.date && post.date !== "undated") {
                item.appendChild(date);
            }

            item.addEventListener("click", (e) => {
                e.preventDefault();
                const target = document.getElementById(post.id);
                if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "start" });
                    history.pushState(null, "", `#${post.id}`);
                    setActiveOutlineItem(post.id);
                }
            });

            outlineContainer.appendChild(item);
        });
    }

    function setActiveOutlineItem(postId) {
        const items = document.querySelectorAll(".outline-item");
        items.forEach(item => {
            if (item.dataset.postId === postId) {
                item.classList.add("active");
            } else {
                item.classList.remove("active");
            }
        });
    }

    function setupOutlineObserver() {
        const entries = document.querySelectorAll(".blog-entry");
        if (!entries.length || !("IntersectionObserver" in window)) return;

        const observer = new IntersectionObserver((observedEntries) => {
            observedEntries.forEach(entry => {
                if (entry.isIntersecting) {
                    setActiveOutlineItem(entry.target.id);
                }
            });
        }, {
            rootMargin: "-10% 0px -70% 0px",
            threshold: 0.05
        });

        entries.forEach(entry => observer.observe(entry));
    }
});

