#!/usr/bin/env python3
"""Blog tool for caseyleblanc.dev (Python 3, standard library only).

Write posts as markdown files in posts/, then compile them into the site.

    python tools/blog.py new "my post title"   create posts/YYYY-MM-DD-my-post-title.md
    python tools/blog.py build                 compile posts/*.md into blog/index.html and about/index.html
    python tools/blog.py check                 exit 1 if the generated pages are out of date

`build` is the default, so `python tools/blog.py` works too. After building, commit and
push the new post and the two regenerated pages:

    git add posts about/index.html blog/index.html
    git commit -m "new post: my post title"
    git push

Post format (frontmatter, then markdown):

    ---
    title: my post title
    date: 2026-10-02
    summary: optional one-liner for the about page (defaults to the first paragraph)
    draft: true            optional, leaves the post out of the build
    ---

Same-day posts are ordered by file name. Headings in a post: # ## ### become h3,
#### h4, ##### h5, ###### h6 (the post title is the page's h2).
"""

import argparse
import datetime as dt
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
BLOG_PAGE = ROOT / "blog" / "index.html"
HOME_PAGE = ROOT / "about" / "index.html"  # the latest posts appear on the about page
LATEST_COUNT = 3

ARROW_SVG = (
    '<svg class="arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
    '<path d="M4 10h11M11 5l5 5-5 5"/></svg>'
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class BlogError(Exception):
    pass


# ---------------------------------------------------------------------------
# markdown -> html (the subset the blog uses, plus the usual extras)
# ---------------------------------------------------------------------------

ENTITY = re.compile(r"&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);")
SAFE_TAG = re.compile(r"<(/?)(br|kbd|sup|sub|mark|small|u|abbr)\s*/?>", re.I)
PH_OPEN, PH_CLOSE = "", ""
PH_RE = re.compile(PH_OPEN + r"(\d+)" + PH_CLOSE)


def esc(text):
    """Escape < > & but leave existing entities such as &#39; alone."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "&":
            m = ENTITY.match(text, i)
            if m:
                out.append(m.group(0))
                i = m.end()
                continue
            out.append("&amp;")
        elif ch == "<":
            out.append("&lt;")
        elif ch == ">":
            out.append("&gt;")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def esc_attr(text):
    return esc(text).replace('"', "&quot;")


def is_external(url):
    return bool(re.match(r"^(?:[a-z][a-z0-9+.-]*:)?//", url, re.I)) or url.lower().startswith("mailto:")


def safe_url(url):
    url = url.strip()
    if re.match(r"^\s*(?:javascript|data|vbscript):", url, re.I):
        return "#"
    return url


def render_inline(text):
    stash = []

    def hold(markup):
        stash.append(markup)
        return f"{PH_OPEN}{len(stash) - 1}{PH_CLOSE}"

    # code spans first, so nothing inside them is touched
    def code_sub(m):
        return hold(f"<code>{html.escape(m.group(2).strip(), quote=False)}</code>")

    text = re.sub(r"(`+)(.+?)\1", code_sub, text)

    # a small allow-list of inline tags, e.g. <br>
    text = SAFE_TAG.sub(lambda m: hold(m.group(0).lower()), text)

    # images and links, with balanced parentheses inside the url
    def scan_target(s, start):
        depth = 1
        i = start
        while i < len(s):
            if s[i] == "(":
                depth += 1
            elif s[i] == ")":
                depth -= 1
                if depth == 0:
                    return i
            i += 1
        return -1

    def convert_links(s):
        out = []
        i = 0
        while i < len(s):
            is_img = s.startswith("![", i)
            if is_img or s[i] == "[":
                label_start = i + (2 if is_img else 1)
                close = s.find("](", label_start)
                if close != -1 and "]" not in s[label_start:close].replace("\\]", ""):
                    end = scan_target(s, close + 2)
                    if end != -1:
                        label = s[label_start:close]
                        target = s[close + 2:end].strip()
                        title = ""
                        tm = re.match(r'^(\S+)\s+"([^"]*)"$', target)
                        if tm:
                            target, title = tm.group(1), tm.group(2)
                        url = safe_url(target)
                        title_attr = f' title="{esc_attr(title)}"' if title else ""
                        if is_img:
                            out.append(hold(
                                f'<img src="{esc_attr(url)}" alt="{esc_attr(label)}"{title_attr} loading="lazy">'
                            ))
                        else:
                            ext = ' target="_blank" rel="noopener noreferrer"' if is_external(url) else ""
                            inner = render_inline(label)
                            out.append(hold(f'<a href="{esc_attr(url)}"{title_attr}{ext}>{inner}</a>'))
                        i = end + 1
                        continue
            out.append(s[i])
            i += 1
        return "".join(out)

    text = convert_links(text)
    text = esc(text)

    # emphasis: asterisks anywhere, underscores only at word edges (so snake_case survives)
    text = re.sub(r"\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\*\w])\*(?=[^\s\*])(.+?)(?<=[^\s\*])\*(?![\*\w])", r"<em>\1</em>", text)
    text = re.sub(r"(?<!\w)___(?=\S)(.+?)(?<=\S)___(?!\w)", r"<strong><em>\1</em></strong>", text)
    text = re.sub(r"(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])", r"<em>\1</em>", text)
    text = re.sub(r"~~(?=\S)(.+?)(?<=\S)~~", r"<del>\1</del>", text)

    while PH_RE.search(text):
        text = PH_RE.sub(lambda m: stash[int(m.group(1))], text)
    return text


HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
HRULE = re.compile(r"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$")
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
FENCE = re.compile(r"^\s{0,3}(```+|~~~+)\s*([A-Za-z0-9_+-]*)\s*$")


def heading_level(md_level):
    return 3 if md_level <= 3 else md_level


def starts_block(line):
    return bool(
        HEADING.match(line) or HRULE.match(line) or FENCE.match(line)
        or line.lstrip().startswith(">") or LIST_ITEM.match(line)
    )


def parse_list(lines, i, indent):
    first = LIST_ITEM.match(lines[i])
    ordered = first.group(2)[0].isdigit()
    tag = "ol" if ordered else "ul"
    items = []
    while i < len(lines):
        m = LIST_ITEM.match(lines[i])
        if not m or len(m.group(1).expandtabs(4)) != indent:
            break
        if m.group(2)[0].isdigit() != ordered:
            break
        text_lines = [m.group(3)]
        nested = ""
        i += 1
        while i < len(lines):
            line = lines[i]
            if not line.strip():
                # a blank line keeps the list going only if the next line is another item
                j = i
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines) and LIST_ITEM.match(lines[j]) and len(LIST_ITEM.match(lines[j]).group(1).expandtabs(4)) >= indent:
                    i = j
                break
            lm = LIST_ITEM.match(line)
            if lm:
                child_indent = len(lm.group(1).expandtabs(4))
                if child_indent > indent:
                    nested, i = parse_list(lines, i, child_indent)
                    continue
                break
            if starts_block(line) and not line.startswith(" "):
                break
            text_lines.append(line.strip())
            i += 1
        body = "<br>\n".join(render_inline(t) for t in text_lines)
        items.append(f"<li>{body}{nested}</li>")
    return f"<{tag}>\n" + "\n".join(items) + f"\n</{tag}>", i


def render_blocks(lines):
    out = []
    i = 0
    first_paragraph = None
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        fm = FENCE.match(line)
        if fm:
            fence, lang = fm.group(1), fm.group(2)
            i += 1
            code = []
            while i < len(lines) and not lines[i].strip().startswith(fence[:3]):
                code.append(lines[i])
                i += 1
            i += 1
            cls = f' class="language-{lang}"' if lang else ""
            out.append(f"<pre><code{cls}>{html.escape(chr(10).join(code), quote=False)}</code></pre>")
            continue

        hm = HEADING.match(line)
        if hm:
            level = heading_level(len(hm.group(1)))
            out.append(f"<h{level}>{render_inline(hm.group(2))}</h{level}>")
            i += 1
            continue

        if HRULE.match(line):
            out.append("<hr>")
            i += 1
            continue

        if line.lstrip().startswith(">"):
            quote = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            inner, _ = render_blocks(quote)
            out.append(f"<blockquote>\n{inner}\n</blockquote>")
            continue

        lm = LIST_ITEM.match(line)
        if lm:
            markup, i = parse_list(lines, i, len(lm.group(1).expandtabs(4)))
            out.append(markup)
            continue

        para = []
        while i < len(lines) and lines[i].strip() and not (para and starts_block(lines[i])):
            para.append(lines[i].strip())
            i += 1
        rendered = "<br>\n".join(render_inline(p) for p in para)
        if first_paragraph is None:
            first_paragraph = rendered
        out.append(f"<p>{rendered}</p>")

    return "\n".join(out), first_paragraph


# ---------------------------------------------------------------------------
# posts
# ---------------------------------------------------------------------------

class Post:
    def __init__(self, path, title, date, summary, body_html, draft):
        self.path = path
        self.title = title
        self.date = date
        self.summary = summary
        self.body_html = body_html
        self.draft = draft
        self.id = ""


def slugify(text, limit=None):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if limit:
        slug = slug[:limit].strip("-")
    return slug


def parse_frontmatter(raw):
    text = raw.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    meta = {}
    if text.startswith("---\n"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[4:end].split("\n"):
                if ":" in line:
                    key, _, value = line.partition(":")
                    meta[key.strip().lower()] = value.strip()
            body = text[end + 4:]
            return meta, body.lstrip("\n")
    return meta, text


def plain_text(markup):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()


def shorten(text, limit=150):
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(".,;:!?-")
    return cut + "..."


def load_post(path):
    meta, body = parse_frontmatter(path.read_text(encoding="utf-8-sig"))

    date_text = meta.get("date") or (re.match(r"^(\d{4}-\d{2}-\d{2})", path.name) or [None, ""])[1]
    try:
        date = dt.date.fromisoformat(date_text)
    except ValueError:
        raise BlogError(f"{path.name}: date must look like 2026-10-02 (got '{date_text}')")

    title = meta.get("title", "").strip()
    if not title:
        m = re.search(r"^#\s+(.+)$", body, re.M)
        title = m.group(1).strip() if m else path.stem
        print(f"  note: {path.name} has no title, using '{title}'")

    body_html, first = render_blocks(body.split("\n"))
    summary = meta.get("summary") or shorten(plain_text(first or ""))
    draft = meta.get("draft", "").lower() in ("true", "yes", "1")
    return Post(path, title, date, summary, body_html, draft)


def load_posts():
    if not POSTS_DIR.is_dir():
        raise BlogError(f"no posts folder at {POSTS_DIR}")
    posts = []
    for path in sorted(POSTS_DIR.glob("*.md")):
        if path.name.startswith("_"):
            continue
        post = load_post(path)
        if post.draft:
            print(f"  skipped draft: {path.name}")
            continue
        posts.append(post)
    posts.sort(key=lambda p: p.path.name)
    posts.sort(key=lambda p: p.date, reverse=True)

    seen = {}
    for post in posts:
        base = f"post-{post.date.isoformat()}-{slugify(post.title)}".rstrip("-")
        n = seen.get(base, 0) + 1
        seen[base] = n
        post.id = base if n == 1 else f"{base}-{n}"
    return posts


# ---------------------------------------------------------------------------
# html fragments
# ---------------------------------------------------------------------------

def nice_date(d):
    return f"{d.strftime('%B').lower()} {d.day}, {d.year}"


def blog_fragment(posts):
    if not posts:
        return '<p class="empty">no posts yet. check back soon.</p>'
    parts = []
    for p in posts:
        parts.append(
            f'<article class="post" id="{p.id}">\n'
            f'<header class="post-head">\n'
            f'<time datetime="{p.date.isoformat()}">{nice_date(p.date)}</time>\n'
            f'<h2 class="post-title">{esc(p.title)}</h2>\n'
            f'</header>\n'
            f'<div class="prose">\n{p.body_html}\n</div>\n'
            f'</article>'
        )
    return "\n".join(parts)


def outline_fragment(posts):
    if not posts:
        return ""
    items = []
    for n, p in enumerate(posts):
        current = ' aria-current="true"' if n == 0 else ""
        items.append(
            f'<li><a class="outline-link" href="#{p.id}" data-post-id="{p.id}"{current}>'
            f'<span class="outline-title">{esc(p.title)}</span>'
            f'<time datetime="{p.date.isoformat()}">{nice_date(p.date)}</time></a></li>'
        )
    return "\n".join(items)


def latest_fragment(posts):
    if not posts:
        return '<li class="row"><p class="row-text">no posts yet.</p></li>'
    rows = []
    for p in posts[:LATEST_COUNT]:
        rows.append(
            f'<li class="row row-post"><a class="row-link" href="../blog/#{p.id}">'
            f'<time datetime="{p.date.isoformat()}">{nice_date(p.date)}</time>'
            f'<span class="row-main"><span class="row-title">{esc(p.title)}</span>'
            f'<span class="row-text">{esc(p.summary)}</span></span>'
            f'{ARROW_SVG}</a></li>'
        )
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# page patching
# ---------------------------------------------------------------------------

def read_page(path):
    raw = path.read_bytes()
    crlf = b"\r\n" in raw
    return raw.decode("utf-8").replace("\r\n", "\n"), crlf


def write_page(path, text, crlf):
    if crlf:
        text = text.replace("\n", "\r\n")
    path.write_bytes(text.encode("utf-8"))


def replace_region(text, name, content, page):
    pattern = re.compile(
        rf"(<!-- blog:{name}:start[^>]*?-->)(.*?)(<!-- blog:{name}:end -->)", re.S
    )
    if not pattern.search(text):
        raise BlogError(f"{page.name}: missing <!-- blog:{name}:start --> ... <!-- blog:{name}:end --> markers")
    return pattern.sub(lambda m: f"{m.group(1)}\n{content}\n{m.group(3)}", text, count=1)


def compile_pages(posts):
    results = {}
    text, crlf = read_page(BLOG_PAGE)
    text = replace_region(text, "outline", outline_fragment(posts), BLOG_PAGE)
    text = replace_region(text, "posts", blog_fragment(posts), BLOG_PAGE)
    results[BLOG_PAGE] = (text, crlf)

    text, crlf = read_page(HOME_PAGE)
    text = replace_region(text, "latest", latest_fragment(posts), HOME_PAGE)
    results[HOME_PAGE] = (text, crlf)
    return results


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_build(check_only=False):
    posts = load_posts()
    results = compile_pages(posts)

    stale = []
    for page, (text, crlf) in results.items():
        current, _ = read_page(page)
        if current != text:
            stale.append(page)
            if not check_only:
                write_page(page, text, crlf)

    if check_only:
        if stale:
            print("out of date: " + ", ".join(str(p.relative_to(ROOT)) for p in stale))
            print("run: python tools/blog.py build")
            return 1
        print(f"up to date ({len(posts)} posts)")
        return 0

    print(f"built {len(posts)} posts")
    for p in posts:
        print(f"  {p.date.isoformat()}  {p.title}")
    if stale:
        print("updated: " + ", ".join(str(p.relative_to(ROOT)) for p in stale))
        print("next:    git add posts about/index.html blog/index.html && git commit && git push")
    else:
        print("pages were already up to date")
    return 0


def cmd_new(title, date_text):
    try:
        date = dt.date.fromisoformat(date_text) if date_text else dt.date.today()
    except ValueError:
        raise BlogError("--date must look like 2026-10-02")
    slug = slugify(title, 48) or "post"
    POSTS_DIR.mkdir(exist_ok=True)
    path = POSTS_DIR / f"{date.isoformat()}-{slug}.md"
    if path.exists():
        raise BlogError(f"{path.name} already exists")
    path.write_text(
        f"---\ntitle: {title}\ndate: {date.isoformat()}\n---\n\nwrite your post here.\n",
        encoding="utf-8",
    )
    print(f"created {path.relative_to(ROOT)}")
    print("write it, then run: python tools/blog.py build")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compile posts/*.md into the site's blog and home pages.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("build", help="compile posts into blog/index.html and about/index.html (default)")
    sub.add_parser("check", help="exit 1 if the generated pages are out of date")
    new = sub.add_parser("new", help="create a new post file from a template")
    new.add_argument("title")
    new.add_argument("--date", help="YYYY-MM-DD, defaults to today")
    args = parser.parse_args(argv)

    try:
        if args.command == "new":
            return cmd_new(args.title, args.date)
        if args.command == "check":
            return cmd_build(check_only=True)
        return cmd_build()
    except BlogError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
