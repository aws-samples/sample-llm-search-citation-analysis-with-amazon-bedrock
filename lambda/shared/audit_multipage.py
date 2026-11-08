"""
The checks that compare crawled pages with each other (``multipage_issues``), run once the crawl is over.

* **Duplicates** (title, meta description, content): among candidate pages, i.e. 2xx HTML, not a JavaScript
  shell, indexable and not canonicalized elsewhere (the owner has already deduplicated the others), two or
  more pages with the same non-empty value each get an issue with the group size and up to three other URLs.
  Content compares the visible-text hash of pages with at least one word.
* **Redirects**: from every chain head (a redirecting URL no other redirect points to) the chain is walked;
  ``redirect-chain`` when it takes two or more redirects, ``redirect-loop`` when it comes back to a URL already
  on it; a cycle no head reaches (a <-> b, a -> a) is one ``redirect-loop`` on its smallest URL.
* **Broken internal links**: a page linking to a crawled internal URL that answered 4xx/5xx (blocked targets
  are not broken) gets one issue per target, at most ``MAX_BROKEN_LINK_ISSUES`` in all.
* **Orphans**: a live 2xx page other than the start page that no other page links to and no redirect points
  to. Only judged when the crawl finished, every page's links were stored in full and no page was a
  JavaScript shell (its links are unknown): otherwise "no inbound link" proves nothing.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

from shared.audit_issues import Issue

MAX_BROKEN_LINK_ISSUES = 2_000
MAX_OTHER_URLS = 3


@dataclass(frozen=True)
class PageSummary:
    """What the cross-page checks need of one stored page."""

    url: str
    status: int
    fetch_class: str
    is_html: bool = False
    redirect_url: str | None = None
    title: str = ''
    meta_description: str = ''
    content_hash: str = ''
    word_count: int = 0
    indexable: bool = True
    canonical: str = ''
    javascript_shell: bool = False
    internal_links: tuple[str, ...] = ()
    links_truncated: bool = False

    @property
    def is_live(self) -> bool:
        return self.fetch_class == 'ok' and 200 <= self.status < 300

    @property
    def is_duplicate_candidate(self) -> bool:
        canonical_ok = not self.canonical or self.canonical == self.url
        return self.is_live and self.is_html and not self.javascript_shell and self.indexable and canonical_ok


def _duplicates(pages: Sequence[PageSummary], issue_type: str, value: Callable[[PageSummary], str]) -> list[Issue]:
    groups: dict[str, list[str]] = defaultdict(list)
    for page in pages:
        key = value(page)
        if key:
            groups[key].append(page.url)
    issues: list[Issue] = []
    for urls in groups.values():
        if len(urls) < 2:
            continue
        for url in urls:
            others = [other for other in urls if other != url][:MAX_OTHER_URLS]
            issues.append(Issue(issue_type, url, {'group_size': len(urls), 'other_urls': others}))
    return issues


def duplicate_issues(pages: Iterable[PageSummary]) -> list[Issue]:
    candidates = [page for page in pages if page.is_duplicate_candidate]
    return [
        *_duplicates(candidates, 'duplicate-title', lambda page: page.title),
        *_duplicates(candidates, 'duplicate-meta-description', lambda page: page.meta_description),
        *_duplicates(candidates, 'duplicate-content', lambda page: page.content_hash if page.word_count > 0 else ''),
    ]


def _walk(head: str, redirects: dict[str, str]) -> tuple[list[str], bool]:
    hops = [head]
    seen = {head}
    current = head
    while current in redirects:
        current = redirects[current]
        if current in seen:
            return [*hops, current], True
        hops.append(current)
        seen.add(current)
    return hops, False


def _headless_cycles(redirects: dict[str, str], visited: set[str]) -> list[list[str]]:
    cycles: list[list[str]] = []
    for start in sorted(redirects):
        if start in visited:
            continue
        hops, looped = _walk(start, redirects)
        visited.update(hops)
        if looped:
            cycle = hops[hops.index(hops[-1]):-1]
            cycles.append(sorted(cycle))
    return cycles


def redirect_issues(pages: Iterable[PageSummary]) -> list[Issue]:
    redirects = {page.url: page.redirect_url for page in pages if page.redirect_url and 300 <= page.status < 400}
    targets = set(redirects.values())
    issues: list[Issue] = []
    visited: set[str] = set()
    for head in sorted(url for url in redirects if url not in targets):
        hops, looped = _walk(head, redirects)
        visited.update(hops)
        if looped:
            issues.append(Issue('redirect-loop', head, {'hops': hops}))
        elif len(hops) > 2:
            issues.append(Issue('redirect-chain', head, {'hops': hops, 'redirects': len(hops) - 1}))
    issues.extend(
        Issue('redirect-loop', cycle[0], {'hops': [*cycle, cycle[0]]}) for cycle in _headless_cycles(redirects, visited)
    )
    return issues


def broken_link_issues(pages: Sequence[PageSummary]) -> list[Issue]:
    broken = {page.url: page.status for page in pages if page.fetch_class == 'ok' and page.status >= 400}
    issues: list[Issue] = []
    for page in pages:
        for target in page.internal_links:
            if target in broken and target != page.url:
                details = {'target_url': target, 'status_code': broken[target]}
                issues.append(Issue('broken-internal-link', page.url, details, dedupe_key=target))
                if len(issues) >= MAX_BROKEN_LINK_ISSUES:
                    return issues
    return issues


def orphans_checkable(pages: Sequence[PageSummary], crawl_complete: bool) -> bool:
    """Whether orphan detection can be trusted: complete crawl, complete link graph, no JavaScript shells."""
    return crawl_complete and not any(page.links_truncated or page.javascript_shell for page in pages)


def orphan_issues(pages: Sequence[PageSummary], start_url: str) -> list[Issue]:
    inbound: set[str] = set()
    for page in pages:
        inbound.update(target for target in page.internal_links if target != page.url)
    redirect_targets = {page.redirect_url for page in pages if page.redirect_url}
    return [
        Issue('orphan-page', page.url)
        for page in pages
        if page.is_live and page.url != start_url and page.url not in inbound and page.url not in redirect_targets
    ]


def multipage_issues(pages: Sequence[PageSummary], start_url: str, *, crawl_complete: bool) -> list[Issue]:
    """Every cross-page issue of a finished crawl."""
    issues = [*duplicate_issues(pages), *redirect_issues(pages), *broken_link_issues(pages)]
    if orphans_checkable(pages, crawl_complete):
        issues.extend(orphan_issues(pages, start_url))
    return issues
