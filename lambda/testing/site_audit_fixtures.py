"""Fakes for the site-audit suites: an in-memory ``AuditStore``, a fake site behind the fetch transport, pages.

The audited site is ``https://www.example.com`` (the brand's own domain is ``example.com``). No test reaches the
network: ``FakeSite`` replaces ``shared.audit_fetch._send`` and the DNS check, and ``no_sleep`` the waits.
"""

from __future__ import annotations

from collections.abc import Generator, Iterable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

from shared import audit_fetch, site_audit_fetcher
from shared.audit_fetch import RawResponse
from shared.audit_issues import Issue
from shared.site_audit_repository import AuditStore, FrontierEntry, issue_item

SITE = 'https://www.example.com'
AUDIT_ID = '0123456789abcdef0123456789abcdef'
OWNED = ['example.com']
STARTED_AT = '2026-10-02T08:00:00.000000Z'

LONG_TEXT = ' '.join(f'word{index}' for index in range(200))


def html_page(
    title: str = 'Example Air flights to Galicia',
    *,
    description: str = 'Book Example Air flights to Galicia with free seat selection and flexible changes on every fare.',
    body: str = f'<h1>Flights</h1><p>{LONG_TEXT}</p><a href="/">Home</a>',
    head: str = '',
) -> str:
    """A complete, issue-free HTML page (title 10-60, description 70-160, one H1, 200 words) unless overridden."""
    return (
        f'<html><head><title>{title}</title><meta name="description" content="{description}">'
        '<script type="application/ld+json">{"@type": "WebPage"}</script>'
        f'{head}</head><body>{body}</body></html>'
    )


def html_response(html: str, status: int = 200, headers: Mapping[str, str] | None = None) -> RawResponse:
    return RawResponse(status=status, headers={'content-type': 'text/html; charset=utf-8', **(headers or {})},
                       body=html.encode('utf-8'))


def text_response(text: str, status: int = 200, content_type: str = 'text/plain') -> RawResponse:
    return RawResponse(status=status, headers={'content-type': content_type}, body=text.encode('utf-8'))


def redirect(location: str, status: int = 301) -> RawResponse:
    return RawResponse(status=status, headers={'location': location}, body=b'')


NOT_FOUND = RawResponse(status=404, headers={'content-type': 'text/html'}, body=b'<html>missing</html>')


@dataclass
class FakeSite:
    """URL -> response; every other URL answers 404. ``requests`` lists each URL fetched, in order."""

    responses: dict[str, RawResponse | list[RawResponse]] = field(default_factory=dict)
    requests: list[str] = field(default_factory=list)

    def send(self, url: str, _headers: Mapping[str, str], _timeout: float, max_bytes: int) -> RawResponse:
        self.requests.append(url)
        answer = self.responses.get(url, NOT_FOUND)
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if len(answer.body) > max_bytes:
            return RawResponse(answer.status, answer.headers, answer.body[:max_bytes], truncated=True)
        return answer


@contextmanager
def serving(site: FakeSite) -> Generator[FakeSite]:
    """Route every audit fetch to ``site``: no DNS, no sockets, no waiting."""
    with patch.object(audit_fetch, '_send', site.send), \
            patch.object(audit_fetch, 'validate_url_safe', return_value=(True, '')), \
            patch.object(site_audit_fetcher.time, 'sleep'):
        yield site


class MemoryAuditStore(AuditStore):
    """``AuditStore`` held in dictionaries: same methods, same claim and merge rules."""

    def __init__(self) -> None:
        # No DynamoDB behind it: an attribute-less table and resource make any method this class does not
        # override fail loudly instead of reaching AWS.
        super().__init__(table=MagicMock(spec=[]), resource=MagicMock(spec=[]))
        self.audits: dict[str, dict[str, Any]] = {}
        self.frontier: dict[str, dict[str, Any]] = {}
        self.pages_by_url: dict[str, dict[str, Any]] = {}
        self.issue_items: dict[str, dict[str, Any]] = {}
        self.link_summary: dict[str, Any] | None = None
        self.seq = 0

    def create_audit(self, audit: dict[str, Any]) -> None:
        self.audits[audit['audit_id']] = dict(audit)

    def get_audit(self, audit_id: str) -> dict[str, Any] | None:
        audit = self.audits.get(audit_id)
        return dict(audit) if audit else None

    def update_audit(self, audit_id: str, changes: dict[str, Any], *, only_if_status: tuple[str, ...] = ()) -> bool:
        audit = self.audits[audit_id]
        if only_if_status and audit.get('status') not in only_if_status:
            return False
        audit.update(changes)
        return True

    def list_audits(self, limit: int) -> list[dict[str, Any]]:
        return sorted(self.audits.values(), key=lambda audit: audit['started_at'], reverse=True)[:limit]

    def add_frontier(self, audit_id: str, entries: Iterable[FrontierEntry], limit: int) -> int:
        added = 0
        for entry in entries:
            known = self.frontier.get(entry.url)
            if known is not None:
                known['in_sitemap'] = known['in_sitemap'] or entry.in_sitemap
                if entry.source == 'link' and known['source'] == 'sitemap' and known['state'] == 'pending':
                    known.update(source='link', depth=entry.depth)
                continue
            if added >= limit:
                continue
            self.seq += 1
            added += 1
            self.frontier[entry.url] = {'entry': entry, 'source': entry.source, 'depth': entry.depth,
                                        'in_sitemap': entry.in_sitemap, 'state': 'pending', 'seq': self.seq,
                                        'chunk_no': None}
        return added

    def _as_entry(self, row: dict[str, Any]) -> FrontierEntry:
        entry: FrontierEntry = row['entry']
        return FrontierEntry(entry.url, row['depth'], row['source'], row['in_sitemap'])

    def claim(self, audit_id: str, chunk_no: int, limit: int) -> list[FrontierEntry]:
        leased = [row for row in self.frontier.values() if row['state'] == 'leased' and row['chunk_no'] == chunk_no]
        if leased:
            return [self._as_entry(row) for row in sorted(leased, key=lambda row: row['seq'])]
        pending = sorted((row for row in self.frontier.values() if row['state'] == 'pending'),
                         key=lambda row: (row['source'] != 'link', row['seq']))[:max(0, limit)]
        for row in pending:
            row.update(state='leased', chunk_no=chunk_no)
        return [self._as_entry(row) for row in pending]

    def has_pending(self, audit_id: str) -> bool:
        return any(row['state'] == 'pending' for row in self.frontier.values())

    def mark_crawled(self, audit_id: str, url: str) -> None:
        self.frontier[url]['state'] = 'crawled'

    def put_page(self, audit_id: str, page: dict[str, Any]) -> None:
        self.pages_by_url[page['url']] = dict(page)

    def page(self, audit_id: str, url: str) -> dict[str, Any] | None:
        return self.pages_by_url.get(url)

    def pages(self, audit_id: str) -> list[dict[str, Any]]:
        return list(self.pages_by_url.values())

    def put_issues(self, audit_id: str, issues: Iterable[Issue]) -> None:
        for issue in issues:
            self.issue_items[issue.issue_id(audit_id)] = issue_item(issue)

    def issues(self, audit_id: str) -> Iterator[dict[str, Any]]:
        yield from self.issue_items.values()

    def issues_of_type(self, audit_id: str, issue_type: str, limit: int, token: str | None) -> tuple[list[dict[str, Any]], str | None]:
        return self._paged([item for item in self.issue_items.values() if item['issue_type'] == issue_type], limit, token)

    def page_batch(self, audit_id: str, limit: int, token: str | None) -> tuple[list[dict[str, Any]], str | None]:
        return self._paged(list(self.pages_by_url.values()), limit, token)

    @staticmethod
    def _paged(items: list[dict[str, Any]], limit: int, token: str | None) -> tuple[list[dict[str, Any]], str | None]:
        start = int(token) if token and token.isdigit() else 0
        end = start + limit
        return items[start:end], (str(end) if end < len(items) else None)

    def put_link_summary(self, audit_id: str, summary: dict[str, Any]) -> None:
        self.link_summary = summary

    # -- helpers for assertions --------------------------------------------------
    def issue_types(self) -> list[str]:
        return sorted({item['issue_type'] for item in self.issue_items.values()})

    def issue_pages(self, issue_type: str) -> list[str]:
        return sorted(item['page_url'] for item in self.issue_items.values() if item['issue_type'] == issue_type)


@dataclass
class RobotsBucket:
    """The raw-responses bucket's robots.txt copies, in memory."""

    bodies: dict[str, tuple[int, str]] = field(default_factory=dict)

    def save(self, audit_id: str, status: int, text: str) -> None:
        self.bodies[audit_id] = (status, text)

    def load(self, audit_id: str) -> tuple[int, str]:
        return self.bodies[audit_id]


@contextmanager
def robots_bucket() -> Generator[RobotsBucket]:
    """Keep robots.txt copies in memory instead of S3."""
    from shared import site_audit_crawl, site_audit_discovery

    bucket = RobotsBucket()
    with patch.object(site_audit_discovery, 'save_robots', bucket.save), \
            patch.object(site_audit_crawl, 'load_robots', bucket.load):
        yield bucket


def new_audit_item(max_pages: int = 500, start_url: str = f'{SITE}/') -> dict[str, Any]:
    return {
        'audit_id': AUDIT_ID, 'start_url': start_url, 'origin': '', 'status': 'running', 'phase': 'discovery',
        'max_pages': max_pages, 'pages_crawled': 0, 'pages_total': 0, 'discovered': 0, 'started_by': 'admin',
        'started_at': STARTED_AT, 'stop_reason': '',
    }


def run_audit(site: FakeSite, *, max_pages: int = 500, start_url: str = f'{SITE}/') -> MemoryAuditStore:
    """Run discovery, every crawl chunk and the closing checks of one audit against ``site``."""
    from shared.site_audit_crawl import crawl_chunk
    from shared.site_audit_discovery import discover, new_fetcher
    from shared.site_audit_finalize import finalize

    store = MemoryAuditStore()
    store.create_audit(new_audit_item(max_pages, start_url))
    with serving(site), robots_bucket():
        audit = store.audits[AUDIT_ID]
        audit.update(discover(store, dict(audit), OWNED, new_fetcher(audit, deadline=None)))
        chunk_no, done = 0, bool(audit['stop_reason'])
        while not done:
            result = crawl_chunk(store, dict(audit), chunk_no)
            audit.update(result['changes'])
            chunk_no, done = result['state']['chunk_no'], result['state']['done']
        audit.update(finalize(store, dict(audit), new_fetcher(audit, deadline=None),
                              completed_at='2026-10-02T09:00:00.000000Z'))
    return store
