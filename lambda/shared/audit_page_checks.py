"""
The checks that need only one crawled page (``page_issues``), run as each page is crawled.

Control flow, in order (a "stop" means no later check runs for the page):

1. blocked -> ``blocked-page``, rate limited -> ``rate-limited-page``, no response -> nothing; stop;
2. 5xx -> ``server-error``; 4xx -> ``broken-page``; 3xx -> nothing (chains are judged across pages); stop;
3. any 2xx slower than 1,500 ms -> ``slow-response``; a non-HTML answer stops here;
4. indexing: ``noindex-page``, ``canonical-conflict`` (HTML vs ``Link`` header), ``canonicalized-page``, and the
   AI-readiness directives ``ai-snippet-restricted`` (indexable pages only) and ``noindex-for-bing``;
5. ``deep-page`` (5+ clicks from the start page); with a rendered copy, the raw-versus-rendered checks
   (``shared.audit_geo.rendered_issues``);
6. a JavaScript shell -> ``javascript-rendering-suspected``; stop (its content checks would be noise);
7. content: title (missing > too long > too short, exclusive), meta description likewise, ``missing-h1`` /
   ``multiple-h1``, ``heading-order-skip``, ``thin-content`` (indexable), ``images-missing-alt``,
   ``no-outgoing-links`` (indexable);
8. structured data: ``structured-data-invalid``, ``structured-data-missing`` (indexable), ``article-schema-missing``,
   ``faq-schema-mismatch``.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from shared.audit_directives import is_indexable, noindex_for_bing_only, snippet_restrictions
from shared.audit_geo import rendered_issues
from shared.audit_issue_registry import (
    DEEP_PAGE_DEPTH,
    META_DESCRIPTION_MAX_CHARS,
    META_DESCRIPTION_MIN_CHARS,
    SLOW_RESPONSE_MS,
    THIN_CONTENT_WORDS,
    TITLE_MAX_CHARS,
    TITLE_MIN_CHARS,
)
from shared.audit_issues import Issue, flagged
from shared.audit_page import PageFacts
from shared.audit_structured import StructuredData
from shared.audit_urls import normalize_url

FETCH_STOP_ISSUES = {'blocked': 'blocked-page', 'rate_limited': 'rate-limited-page'}


@dataclass(frozen=True)
class CrawledPage:
    """One fetched URL as the checks see it; ``facts`` / ``structured`` are set for 2xx HTML only."""

    url: str
    status: int
    fetch_class: str
    response_ms: int
    content_type: str = ''
    redirect_url: str | None = None
    depth: int | None = None
    in_sitemap: bool = False
    x_robots_tag: str = ''
    header_canonical: str = ''
    facts: PageFacts | None = None
    structured: StructuredData | None = None
    rendered: PageFacts | None = None
    """The page rendered with JavaScript, when a rendered copy was made (compared with ``facts``)."""

    @property
    def is_html(self) -> bool:
        return 'text/html' in self.content_type.lower()

    @property
    def indexable(self) -> bool:
        robots = self.facts.robots_meta if self.facts else ''
        return is_indexable(robots, self.x_robots_tag)

    @property
    def html_canonical(self) -> str:
        return self.facts.canonical if self.facts else ''

    @property
    def effective_canonical(self) -> str:
        """The HTML canonical, else the ``Link`` header one, normalized (``''`` when neither is set)."""
        raw = self.html_canonical or self.header_canonical
        return (normalize_url(raw, self.url) or '') if raw else ''


def _fetch_issues(page: CrawledPage) -> list[Issue] | None:
    """Issues of a page that could not be read as content (``None``: carry on with the content checks)."""
    if page.fetch_class != 'ok':
        stop = FETCH_STOP_ISSUES.get(page.fetch_class)
        return [Issue(stop, page.url, {'status_code': page.status})] if stop else []
    if page.status >= 500:
        return [Issue('server-error', page.url, {'status_code': page.status})]
    if page.status >= 400:
        return [Issue('broken-page', page.url, {'status_code': page.status})]
    if page.status >= 300 or page.status < 200:
        return []
    return None


def _indexing_issues(page: CrawledPage) -> list[Issue]:
    issues: list[Issue] = []
    if not page.indexable:
        issues.append(Issue('noindex-page', page.url))
    header = normalize_url(page.header_canonical, page.url) if page.header_canonical else ''
    if page.html_canonical and header and page.html_canonical != header:
        issues.append(Issue('canonical-conflict', page.url, {'html': page.html_canonical, 'header': header}))
    canonical = page.effective_canonical
    if canonical and canonical != page.url:
        issues.append(Issue('canonicalized-page', page.url, {'canonical': canonical}))
    bot_meta = page.facts.bot_meta if page.facts else {}
    restricted = snippet_restrictions(bot_meta, page.x_robots_tag)
    if restricted and page.indexable:
        issues.append(Issue('ai-snippet-restricted', page.url, {'directives': restricted}))
    if noindex_for_bing_only(bot_meta, page.x_robots_tag):
        issues.append(Issue('noindex-for-bing', page.url))
    return issues


def _length_issue(url: str, text: str, kinds: tuple[str, str, str], bounds: tuple[int, int]) -> Issue | None:
    missing, too_long, too_short = kinds
    longest, shortest = bounds
    if not text:
        return Issue(missing, url)
    if len(text) > longest:
        return Issue(too_long, url, {'length': len(text), 'text': flagged(text)})
    if len(text) < shortest:
        return Issue(too_short, url, {'length': len(text), 'text': flagged(text)})
    return None


def _heading_skip(levels: tuple[int, ...]) -> tuple[int, int] | None:
    for previous, level in pairwise(levels):
        if level > previous + 1:
            return previous, level
    return None


def _content_issues(page: CrawledPage, facts: PageFacts) -> list[Issue]:
    title = _length_issue(page.url, facts.title, ('missing-title', 'title-too-long', 'title-too-short'),
                          (TITLE_MAX_CHARS, TITLE_MIN_CHARS))
    description = _length_issue(
        page.url, facts.meta_description,
        ('missing-meta-description', 'meta-description-too-long', 'meta-description-too-short'),
        (META_DESCRIPTION_MAX_CHARS, META_DESCRIPTION_MIN_CHARS),
    )
    issues = [issue for issue in (title, description) if issue is not None]
    if facts.h1_count == 0:
        issues.append(Issue('missing-h1', page.url))
    elif facts.h1_count > 1:
        issues.append(Issue('multiple-h1', page.url, {'count': facts.h1_count}))
    skip = _heading_skip(facts.headings)
    if skip is not None:
        issues.append(Issue('heading-order-skip', page.url, {'from': f'h{skip[0]}', 'to': f'h{skip[1]}'}))
    if page.indexable and facts.word_count < THIN_CONTENT_WORDS:
        issues.append(Issue('thin-content', page.url, {'word_count': facts.word_count}))
    if facts.images_missing_alt > 0:
        issues.append(Issue('images-missing-alt', page.url,
                            {'missing': facts.images_missing_alt, 'total': facts.images_total}))
    if page.indexable and not facts.links:
        issues.append(Issue('no-outgoing-links', page.url))
    return issues


def _structured_issues(page: CrawledPage, facts: PageFacts, data: StructuredData) -> list[Issue]:
    issues = [
        Issue('structured-data-invalid', page.url, {'block_index': index, 'error': message}, dedupe_key=str(index))
        for index, message in data.errors
    ]
    declared = bool(data.types) or facts.has_microdata or facts.has_rdfa
    if page.indexable and not declared:
        issues.append(Issue('structured-data-missing', page.url))
    looks_like_article = facts.og.get('og:type', '').lower() == 'article' or (
        facts.has_article_element and facts.has_date_published
    )
    if looks_like_article and not data.has_article:
        issues.append(Issue('article-schema-missing', page.url))
    if any(count == 0 for count in data.faq_question_counts):
        issues.append(Issue('faq-schema-mismatch', page.url))
    return issues


def page_issues(page: CrawledPage) -> list[Issue]:
    """Every single-page issue of ``page``, in the order of the control flow above."""
    stopped = _fetch_issues(page)
    if stopped is not None:
        return stopped
    issues: list[Issue] = []
    if page.response_ms > SLOW_RESPONSE_MS:
        issues.append(Issue('slow-response', page.url, {'response_ms': page.response_ms}))
    if not page.is_html or page.facts is None:
        return issues
    issues.extend(_indexing_issues(page))
    if page.depth is not None and page.depth >= DEEP_PAGE_DEPTH:
        issues.append(Issue('deep-page', page.url, {'depth': page.depth}))
    if page.rendered is not None:
        issues.extend(rendered_issues(page.url, page.facts, page.rendered))
    if page.facts.javascript_shell:
        issues.append(Issue('javascript-rendering-suspected', page.url))
        return issues
    issues.extend(_content_issues(page, page.facts))
    if page.structured is not None:
        issues.extend(_structured_issues(page, page.facts, page.structured))
    return issues
