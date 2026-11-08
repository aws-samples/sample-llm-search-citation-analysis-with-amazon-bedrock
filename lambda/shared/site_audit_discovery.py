"""
First step of an audit: anchor the start URL, read robots.txt and the sitemaps, and seed the frontier.

1. **Start URL**: fetched with redirects followed (at most 5 hops, each on an owned domain and re-validated),
   so an apex that redirects to ``www`` anchors the crawl on ``www``; when the probe fails the requested URL is
   kept.
2. **robots.txt** of that origin (500 KiB, 10 s, redirects followed): its body is kept for the crawl and the
   AI-readiness checks. Unreachable (5xx, timeout) means complete disallow: the audit crawls nothing and
   reports ``robots-unreachable``.
3. **Sitemaps**: the robots.txt ``Sitemap:`` lines plus ``/sitemap.xml``, same-origin only (also after
   redirects), indexes followed to depth 3, at most 300 documents, documents over 10 MiB skipped whole.
4. **Seeds**: the start URL (depth 0) and every same-origin, crawlable, robots-allowed sitemap URL (no depth
   until a link reaches it), at most ``max_discovered(max_pages)`` URLs; ``pages_total`` is
   ``min(seeded, max_pages)``.

All requests share the audit's throttle (1 request/s).
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable
from typing import Any

from shared.audit_fetch import (
    CRAWLER_NAME,
    HTML_ACCEPT,
    MAX_ROBOTS_BYTES,
    MAX_SITEMAP_BYTES,
    TEXT_ACCEPT,
    XML_ACCEPT,
)
from shared.audit_robots import RobotsPolicy, policy_for
from shared.audit_sitemaps import (
    MAX_SITEMAP_DEPTH,
    MAX_SITEMAP_DOCS,
    SITEMAP_TIMEOUT_S,
    looks_like_sitemap,
    parse_sitemap,
)
from shared.audit_throttle import Throttle
from shared.audit_urls import host_of, is_crawlable, is_same_origin, normalize_url, origin_of, path_and_query
from shared.kpi_engine import is_owned_domain, normalize_domain
from shared.site_audit_fetcher import FetchDeferredError, PoliteFetcher
from shared.site_audit_repository import AuditStore, FrontierEntry, save_robots

logger = logging.getLogger(__name__)

ROBOTS_TIMEOUT_S = 10.0
START_PROBE_BYTES = 64 * 1024
START_TIMEOUT_S = 10.0
CRAWLER_AGENTS = (CRAWLER_NAME,)


def max_discovered(max_pages: int) -> int:
    """How many URLs the frontier may hold: twenty per page budgeted, at least 500, at most 50,000."""
    return min(max(max_pages * 20, 500), 50_000)


def resolve_start(fetcher: PoliteFetcher, start_url: str, owned_domains: list[str]) -> str:
    """The URL the start URL settles on after its redirects (the requested one when the probe fails)."""
    try:
        result = fetcher.fetch(
            start_url, max_bytes=START_PROBE_BYTES, accept=HTML_ACCEPT, timeout_s=START_TIMEOUT_S,
            follow_hop=lambda target: is_owned_domain(normalize_domain(host_of(target)) or '', owned_domains),
        )
    except FetchDeferredError:
        return start_url
    if result.status == 0:
        return start_url
    return normalize_url(result.url) or start_url


def read_robots(fetcher: PoliteFetcher, origin: str) -> tuple[RobotsPolicy, str]:
    """The robots.txt policy of ``origin`` and its body; a site that keeps answering 429 counts as unreachable."""
    try:
        result = fetcher.fetch(
            f'{origin}/robots.txt', max_bytes=MAX_ROBOTS_BYTES, accept=TEXT_ACCEPT, timeout_s=ROBOTS_TIMEOUT_S,
            follow_hop=is_crawlable,
        )
    except FetchDeferredError:
        return policy_for(429, ''), ''
    text = result.text() if 200 <= result.status < 300 else ''
    return policy_for(result.status, text), text


class SitemapReader:
    """Breadth-first walk of the site's sitemaps within the depth and document limits."""

    def __init__(self, fetcher: PoliteFetcher, origin: str, allowed: Callable[[str], bool], limit: int) -> None:
        self.fetcher = fetcher
        self.origin = origin
        self.allowed = allowed
        self.limit = limit
        self.urls: dict[str, None] = {}
        self.documents = 0

    def _same_site(self, url: str) -> bool:
        return is_same_origin(url, self.origin)

    def _document(self, url: str) -> tuple[str, tuple[str, ...]] | None:
        result = self.fetcher.fetch(
            url, max_bytes=MAX_SITEMAP_BYTES, accept=XML_ACCEPT, timeout_s=SITEMAP_TIMEOUT_S,
            follow_hop=self._same_site,
        )
        self.documents += 1
        if not 200 <= result.status < 300 or result.truncated or not self._same_site(result.url):
            return None
        body = result.text()
        if not looks_like_sitemap(result.content_type, body):
            return None
        sitemap = parse_sitemap(body)
        return sitemap.kind, sitemap.locations

    def read(self, sources: list[str]) -> list[str]:
        queue = deque((url, 1) for url in dict.fromkeys(sources))
        seen = set(dict.fromkeys(sources))
        while queue and self.documents < MAX_SITEMAP_DOCS and len(self.urls) < self.limit:
            url, depth = queue.popleft()
            try:
                document = self._document(url)
            except FetchDeferredError:
                # The site asked for a long pause: crawl what is known rather than stall discovery.
                break
            if document is None:
                continue
            kind, locations = document
            for location in locations:
                target = normalize_url(location, url)
                if target is None or not self._same_site(target):
                    continue
                if kind == 'index' and depth < MAX_SITEMAP_DEPTH and target not in seen:
                    seen.add(target)
                    queue.append((target, depth + 1))
                elif kind == 'urlset' and is_crawlable(target) and self.allowed(target):
                    self.urls.setdefault(target)
        return list(self.urls)[:self.limit]


def sitemap_sources(policy: RobotsPolicy, origin: str) -> list[str]:
    declared = (normalize_url(url, origin) for url in policy.robots.sitemaps)
    same_site = [url for url in declared if url and is_same_origin(url, origin)]
    return [*same_site, f'{origin}/sitemap.xml']


def discover(store: AuditStore, audit: dict[str, Any], owned_domains: list[str], fetcher: PoliteFetcher) -> dict[str, Any]:
    """Run discovery for ``audit``; returns the changes to save on the audit item."""
    audit_id = str(audit['audit_id'])
    max_pages = int(audit['max_pages'])
    start_url = resolve_start(fetcher, str(audit['start_url']), owned_domains)
    origin = origin_of(start_url)
    policy, robots_text = read_robots(fetcher, origin)
    save_robots(audit_id, policy.status, robots_text)

    def allowed(url: str) -> bool:
        return is_same_origin(url, origin) and policy.allows(CRAWLER_AGENTS, path_and_query(url))

    limit = max_discovered(max_pages)
    sitemap_urls = (
        SitemapReader(fetcher, origin, allowed, limit).read(sitemap_sources(policy, origin))
        if policy.kind != 'disallow_all' else []
    )
    in_sitemap = set(sitemap_urls)
    seeds: list[FrontierEntry] = []
    if allowed(start_url):
        seeds.append(FrontierEntry(url=start_url, depth=0, source='link', in_sitemap=start_url in in_sitemap))
    seeds.extend(FrontierEntry(url=url, depth=None, source='sitemap', in_sitemap=True)
                 for url in sitemap_urls if url != start_url)
    added = store.add_frontier(audit_id, seeds, limit)
    logger.info('audit %s discovery: %d seeds, robots status %s', audit_id, added, policy.status)
    stop_reason = 'robots_unreachable' if policy.kind == 'disallow_all' else ''
    if not stop_reason and fetcher.throttle.stopped:
        stop_reason = 'rate_limited'
    return {
        'start_url': start_url,
        'origin': origin,
        'robots_status': policy.status,
        'robots_kind': policy.kind,
        'sitemap_urls': len(sitemap_urls),
        'discovered': added,
        'pages_total': min(added, max_pages),
        'stop_reason': stop_reason,
        'throttle': fetcher.throttle.to_state(),
    }


def new_fetcher(audit: dict[str, Any], deadline: float | None) -> PoliteFetcher:
    return PoliteFetcher(throttle=Throttle.from_state(audit.get('throttle')), deadline=deadline)
