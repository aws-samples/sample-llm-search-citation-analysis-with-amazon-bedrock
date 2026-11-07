"""
What the audit reads from one HTML page, in a single streaming pass (``html.parser``, no DOM tree).

Rules:

* **Links**: ``<a href>`` resolved against the page and normalized (``shared.audit_urls``); ``javascript:``,
  ``mailto:``, ``tel:`` and ``#`` links are skipped; one entry per target; at most ``MAX_LINKS`` links and
  ``MAX_IMAGES`` images. A link is internal when it is same-origin with the page; ``rel=nofollow`` is kept.
* **Visible text** leaves out ``script``, ``style``, ``noscript``, ``svg`` and ``template``; it is the body text
  when a ``<body>`` is seen, else everything outside ``<head>``; whitespace is collapsed and words are runs of
  non-space characters.
* **Meta** names are case-insensitive and the first value wins (``description``, ``robots``, and the
  ``googlebot`` / ``bingbot`` bot-specific forms); ``og:*`` by ``property``; ``<link rel=canonical>``.
* **Title**: the first ``<title>`` outside ``<svg>``. Headings h1-h6 are recorded in order; ``h1_count`` counts
  the non-empty h1s.
* **Structured data**: every ``<script>`` whose type, trimmed and lower-cased, starts with
  ``application/ld+json`` (parameters such as ``; charset=utf-8`` allowed), plus microdata
  (``itemscope`` + ``itemtype``) and RDFa (``typeof``) presence.
* **JavaScript shell**: an app root outside ``<head>`` (``id`` root / app / __next / __nuxt, or ``<app-root>``),
  an executable script, fewer than 20 words and no heading, link or image: the HTML is a client-rendered
  container whose content checks would only produce noise.
* ``images_missing_alt`` counts images with no ``alt`` attribute at all (``alt=""`` is right for decoration).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from html.parser import HTMLParser

from shared.audit_urls import is_same_origin, normalize_url

MAX_LINKS = 1_000
MAX_IMAGES = 1_000
MIN_SHELL_WORDS = 20
HIDDEN_TAGS = frozenset({'script', 'style', 'noscript', 'svg', 'template'})
APP_ROOT_IDS = frozenset({'root', 'app', '__next', '__nuxt'})
SKIPPED_LINK_PREFIXES = ('javascript:', 'mailto:', 'tel:', '#')
BOT_META_NAMES = ('robots', 'googlebot', 'bingbot')
JS_SCRIPT_TYPES = frozenset({'', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript'})
DATE_PUBLISHED_NAMES = frozenset({'datepublished', 'article:published_time'})


@dataclass(frozen=True)
class PageLink:
    url: str
    internal: bool
    nofollow: bool


@dataclass(frozen=True)
class PageFacts:
    """The facts of one page the issue checks read (the HTML itself is never stored)."""

    title: str
    meta_description: str
    bot_meta: dict[str, str]
    canonical: str
    og: dict[str, str]
    headings: tuple[int, ...]
    h1_count: int
    first_h1: str
    word_count: int
    content_hash: str
    links: tuple[PageLink, ...]
    images_total: int
    images_missing_alt: int
    json_ld: tuple[str, ...]
    has_microdata: bool
    has_rdfa: bool
    has_article_element: bool
    has_date_published: bool
    javascript_shell: bool

    @property
    def internal_links(self) -> tuple[str, ...]:
        return tuple(link.url for link in self.links if link.internal)

    @property
    def robots_meta(self) -> str:
        return self.bot_meta.get('robots', '')


def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
    return {name.lower(): (value or '') for name, value in attrs}


class _PageParser(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.hidden_depth = 0
        self.svg_depth = 0
        self.in_head = False
        self.seen_body = False
        self.body_text: list[str] = []
        self.other_text: list[str] = []
        self.title: str | None = None
        self.title_parts: list[str] | None = None
        self.h1_parts: list[str] | None = None
        self.h1_texts: list[str] = []
        self.headings: list[int] = []
        self.meta: dict[str, str] = {}
        self.og: dict[str, str] = {}
        self.canonical = ''
        self.links: dict[str, PageLink] = {}
        self.images_total = 0
        self.images_missing_alt = 0
        self.json_ld: list[str] = []
        self.json_ld_parts: list[str] | None = None
        self.has_microdata = False
        self.has_rdfa = False
        self.has_article = False
        self.has_date_published = False
        self.app_root = False
        self.executable_script = False

    # -- tags -------------------------------------------------------------
    def _open(self, tag: str, attrs: list[tuple[str, str | None]], *, self_closing: bool) -> None:
        values = _attrs(attrs)
        self._structure_flags(tag, values)
        handler = _START_HANDLERS.get(tag)
        # A self-closing <svg/> or <script/> opens nothing, so it must not enter a hidden or svg block.
        if handler is not None and not (self_closing and tag in HIDDEN_TAGS):
            handler(self, values)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, self_closing=False)
        if tag in HIDDEN_TAGS:
            self.hidden_depth += 1
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.headings.append(int(tag[1]))
            if tag == 'h1':
                self.h1_parts = []

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._open(tag, attrs, self_closing=True)

    def handle_endtag(self, tag: str) -> None:
        if tag in HIDDEN_TAGS and self.hidden_depth > 0:
            self.hidden_depth -= 1
        if tag == 'svg' and self.svg_depth > 0:
            self.svg_depth -= 1
        if tag == 'head':
            self.in_head = False
        elif tag == 'title' and self.title_parts is not None:
            self.title = ' '.join(''.join(self.title_parts).split())
            self.title_parts = None
        elif tag == 'h1' and self.h1_parts is not None:
            self.h1_texts.append(' '.join(''.join(self.h1_parts).split()))
            self.h1_parts = None
        elif tag == 'script' and self.json_ld_parts is not None:
            self.json_ld.append(''.join(self.json_ld_parts))
            self.json_ld_parts = None

    def handle_data(self, data: str) -> None:
        if self.json_ld_parts is not None:
            self.json_ld_parts.append(data)
        if self.title_parts is not None:
            self.title_parts.append(data)
            return
        if self.hidden_depth > 0 or self.in_head:
            return
        if self.h1_parts is not None:
            self.h1_parts.append(data)
        (self.body_text if self.seen_body else self.other_text).append(data)

    # -- per-tag handlers -------------------------------------------------
    def _structure_flags(self, tag: str, values: dict[str, str]) -> None:
        if 'itemscope' in values and values.get('itemtype'):
            self.has_microdata = True
        if values.get('typeof'):
            self.has_rdfa = True
        if values.get('itemprop', '').lower() == 'datepublished':
            self.has_date_published = True
        if not self.in_head and (tag == 'app-root' or values.get('id', '') in APP_ROOT_IDS):
            self.app_root = True

    def start_head(self, _values: dict[str, str]) -> None:
        self.in_head = not self.seen_body

    def start_body(self, _values: dict[str, str]) -> None:
        self.in_head = False
        self.seen_body = True
        # Text seen before <body> (outside <head>) is not body text.
        self.other_text.clear()

    def start_svg(self, _values: dict[str, str]) -> None:
        self.svg_depth += 1

    def start_title(self, _values: dict[str, str]) -> None:
        if self.title is None and self.svg_depth == 0 and self.title_parts is None:
            self.title_parts = []

    def start_meta(self, values: dict[str, str]) -> None:
        content = values.get('content', '').strip()
        name = values.get('name', '').strip().lower()
        prop = values.get('property', '').strip().lower()
        if name and name not in self.meta:
            self.meta[name] = content
        if prop.startswith('og:') and prop not in self.og:
            self.og[prop] = content
        if name in DATE_PUBLISHED_NAMES or prop in DATE_PUBLISHED_NAMES:
            self.has_date_published = True

    def start_link(self, values: dict[str, str]) -> None:
        if values.get('rel', '').strip().lower() == 'canonical' and not self.canonical:
            self.canonical = normalize_url(values.get('href', ''), self.page_url) or ''

    def start_a(self, values: dict[str, str]) -> None:
        href = values.get('href', '').strip()
        if not href or href.lower().startswith(SKIPPED_LINK_PREFIXES) or len(self.links) >= MAX_LINKS:
            return
        target = normalize_url(href, self.page_url)
        if target is None or target in self.links:
            return
        nofollow = 'nofollow' in values.get('rel', '').lower().split()
        self.links[target] = PageLink(url=target, internal=is_same_origin(target, self.page_url), nofollow=nofollow)

    def start_img(self, values: dict[str, str]) -> None:
        if self.images_total >= MAX_IMAGES:
            return
        self.images_total += 1
        if 'alt' not in values:
            self.images_missing_alt += 1

    def start_script(self, values: dict[str, str]) -> None:
        script_type = values.get('type', '').strip().lower()
        if script_type.startswith('application/ld+json'):
            self.json_ld_parts = []
        elif script_type in JS_SCRIPT_TYPES:
            self.executable_script = True

    def start_article(self, _values: dict[str, str]) -> None:
        self.has_article = True


_START_HANDLERS = {
    'head': _PageParser.start_head,
    'body': _PageParser.start_body,
    'svg': _PageParser.start_svg,
    'title': _PageParser.start_title,
    'meta': _PageParser.start_meta,
    'link': _PageParser.start_link,
    'a': _PageParser.start_a,
    'img': _PageParser.start_img,
    'script': _PageParser.start_script,
    'article': _PageParser.start_article,
}


def analyze_page(html: str, page_url: str) -> PageFacts:
    """The facts of ``html`` served at ``page_url`` (already normalized)."""
    parser = _PageParser(page_url)
    parser.feed(html)
    parser.close()
    text = ' '.join(' '.join(parser.body_text if parser.seen_body else parser.other_text).split())
    word_count = len(text.split()) if text else 0
    no_structure = not parser.headings and not parser.links and parser.images_total == 0
    shell = parser.app_root and parser.executable_script and word_count < MIN_SHELL_WORDS and no_structure
    return PageFacts(
        title=parser.title or '',
        meta_description=parser.meta.get('description', ''),
        bot_meta={name: parser.meta[name] for name in BOT_META_NAMES if name in parser.meta},
        canonical=parser.canonical,
        og=dict(parser.og),
        headings=tuple(parser.headings),
        h1_count=sum(1 for h1 in parser.h1_texts if h1),
        first_h1=next((h1 for h1 in parser.h1_texts if h1), ''),
        word_count=word_count,
        content_hash='' if shell else hashlib.sha256(text.encode('utf-8')).hexdigest(),
        links=tuple(parser.links.values()),
        images_total=parser.images_total,
        images_missing_alt=parser.images_missing_alt,
        json_ld=tuple(parser.json_ld),
        has_microdata=parser.has_microdata,
        has_rdfa=parser.has_rdfa,
        has_article_element=parser.has_article,
        has_date_published=parser.has_date_published,
        javascript_shell=shell,
    )
