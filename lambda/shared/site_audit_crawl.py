"""
One crawl step of an audit: claim up to 200 frontier URLs and crawl them politely for at most 90 s.

Each URL is fetched once, without following redirects (every hop is its own page, so chains and loops can be
judged), its HTML read (1 MiB at most) and analysed, its single-page issues written, its page facts stored (the
HTML is not), and its redirect target and internal links queued when they are same-origin, crawlable and
allowed by robots.txt for the audit crawler. Links get the page's depth plus one; a redirect target keeps the
page's depth (a redirect is not a click).

The step ends after ``CHUNK_TARGET_PAGES`` pages, after ``CHUNK_SOFT_DEADLINE_S``, when the site asks for a
pause longer than the step may wait (the state machine then waits ``wait_seconds``), or when the throttle stops
the crawl. URLs it leased but did not crawl stay with the same chunk number, so the next step (or a retried
one) crawls exactly those first.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from shared.audit_classify import classify_fetch
from shared.audit_directives import link_header_canonical
from shared.audit_fetch import CRAWLER_NAME, HTML_ACCEPT, MAX_HTML_BYTES, PAGE_TIMEOUT_S, FetchResult
from shared.audit_issues import Issue
from shared.audit_page import analyze_page
from shared.audit_page_checks import CrawledPage, page_issues
from shared.audit_robots import RobotsPolicy, policy_for
from shared.audit_structured import ORGANIZATION_TYPES, read_json_ld
from shared.audit_throttle import now_ms
from shared.audit_urls import is_crawlable, is_same_origin, path_and_query
from shared.site_audit_discovery import max_discovered, new_fetcher
from shared.site_audit_fetcher import FetchDeferredError, PoliteFetcher
from shared.site_audit_repository import AuditStore, FrontierEntry, load_robots

CHUNK_TARGET_PAGES = 200
CHUNK_SOFT_DEADLINE_S = 90.0
MAX_STORED_LINKS = 500
MAX_TITLE_CHARS = 300


@dataclass(frozen=True)
class CrawlOutcome:
    """What crawling one URL produced."""

    page_item: dict[str, Any]
    issues: list[Issue]
    discovered: list[FrontierEntry]


def _child_depth(depth: int | None, step: int) -> int | None:
    return None if depth is None else depth + step


def page_item(page: CrawledPage, issues: list[Issue]) -> dict[str, Any]:
    """The stored facts of a crawled page (no HTML): what the API, the summary and cross-page checks read."""
    facts, structured = page.facts, page.structured
    internal = facts.internal_links if facts else ()
    types = structured.types if structured else ()
    return {
        'url': page.url, 'status': page.status, 'fetch_class': page.fetch_class, 'is_html': page.is_html,
        'redirect_url': page.redirect_url, 'response_ms': page.response_ms, 'depth': page.depth,
        'in_sitemap': page.in_sitemap,
        'title': facts.title[:MAX_TITLE_CHARS] if facts else '',
        'meta_description': facts.meta_description[:MAX_TITLE_CHARS] if facts else '',
        'h1': facts.first_h1[:MAX_TITLE_CHARS] if facts else '', 'h1_count': facts.h1_count if facts else 0,
        'word_count': facts.word_count if facts else 0, 'content_hash': facts.content_hash if facts else '',
        'indexable': page.indexable, 'canonical': page.effective_canonical,
        'javascript_shell': facts.javascript_shell if facts else False,
        'internal_links': list(internal[:MAX_STORED_LINKS]), 'links_truncated': len(internal) > MAX_STORED_LINKS,
        'internal_link_count': len(internal),
        'external_link_count': (len(facts.links) - len(internal)) if facts else 0,
        'images_total': facts.images_total if facts else 0,
        'images_missing_alt': facts.images_missing_alt if facts else 0,
        'schema_types': list(types),
        'organizations': structured.organizations if structured else 0,
        'organizations_with_same_as': structured.organizations_with_same_as if structured else 0,
        'has_organization_markup': any(kind in ORGANIZATION_TYPES for kind in types),
        'issue_count': len(issues),
    }


def crawled_page(entry: FrontierEntry, result: FetchResult) -> CrawledPage:
    """The checks' view of one fetch."""
    text = result.text()
    fetch_class = classify_fetch(result.status, result.headers, text)
    page = CrawledPage(
        url=entry.url, status=result.status, fetch_class=fetch_class, response_ms=result.elapsed_ms,
        content_type=result.content_type, redirect_url=result.location, depth=entry.depth,
        in_sitemap=entry.in_sitemap, x_robots_tag=result.headers.get('x-robots-tag', ''),
        header_canonical=link_header_canonical(result.headers.get('link', '')),
    )
    if fetch_class != 'ok' or not 200 <= result.status < 300 or not page.is_html:
        return page
    facts = analyze_page(text, entry.url)
    return replace(page, facts=facts, structured=read_json_ld(facts.json_ld))


def crawl_url(entry: FrontierEntry, fetcher: PoliteFetcher, queueable: Callable[[str], bool]) -> CrawlOutcome:
    result = fetcher.fetch(entry.url, max_bytes=MAX_HTML_BYTES, accept=HTML_ACCEPT, timeout_s=PAGE_TIMEOUT_S)
    page = crawled_page(entry, result)
    issues = page_issues(page)
    discovered: list[FrontierEntry] = []
    if page.redirect_url and queueable(page.redirect_url):
        discovered.append(FrontierEntry(page.redirect_url, entry.depth, 'link', in_sitemap=False))
    if page.facts is not None:
        child_depth = _child_depth(entry.depth, 1)
        discovered.extend(
            FrontierEntry(url, child_depth, 'link', in_sitemap=False)
            for url in page.facts.internal_links if queueable(url)
        )
    return CrawlOutcome(page_item=page_item(page, issues), issues=issues, discovered=discovered)


def robots_policy(audit_id: str) -> RobotsPolicy:
    status, text = load_robots(audit_id)
    return policy_for(status, text)


@dataclass
class _ChunkProgress:
    crawled: int = 0
    added: int = 0


def crawl_chunk(
    store: AuditStore, audit: dict[str, Any], chunk_no: int, *, clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Crawl one chunk; returns ``{'changes': <audit item changes>, 'state': <next state machine input>}``."""
    audit_id, origin = str(audit['audit_id']), str(audit['origin'])
    max_pages, attempted = int(audit['max_pages']), int(audit.get('pages_crawled', 0))
    discovered = int(audit.get('discovered', 0))
    policy = robots_policy(audit_id)
    fetcher = new_fetcher(audit, deadline=clock() + CHUNK_SOFT_DEADLINE_S)

    def queueable(url: str) -> bool:
        return is_same_origin(url, origin) and is_crawlable(url) and policy.allows((CRAWLER_NAME,), path_and_query(url))

    entries = store.claim(audit_id, chunk_no, min(CHUNK_TARGET_PAGES, max_pages - attempted))
    progress = _ChunkProgress()
    for entry in entries:
        if clock() > (fetcher.deadline or 0) or fetcher.throttle.stopped:
            break
        try:
            outcome = crawl_url(entry, fetcher, queueable)
        except FetchDeferredError:
            break
        store.put_page(audit_id, outcome.page_item)
        store.put_issues(audit_id, outcome.issues)
        budget = max_discovered(max_pages) - discovered - progress.added
        progress.added += store.add_frontier(audit_id, outcome.discovered, budget)
        store.mark_crawled(audit_id, entry.url)
        progress.crawled += 1
    leftover = len(entries) - progress.crawled
    pages_crawled = attempted + progress.crawled
    stopped = fetcher.throttle.stopped
    done = stopped or (leftover == 0 and (pages_crawled >= max_pages or not store.has_pending(audit_id)))
    wait_ms = 0 if done else fetcher.throttle.wait_ms(now_ms())
    changes = {
        'pages_crawled': pages_crawled,
        'discovered': discovered + progress.added,
        'pages_total': min(discovered + progress.added, max_pages),
        'throttle': fetcher.throttle.to_state(),
        'stop_reason': 'rate_limited' if stopped else str(audit.get('stop_reason') or ''),
    }
    state = {
        'audit_id': audit_id,
        'chunk_no': chunk_no if leftover > 0 else chunk_no + 1,
        'done': done,
        'wait_seconds': math.ceil(wait_ms / 1000),
    }
    return {'changes': changes, 'state': state}
