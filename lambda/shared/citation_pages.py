"""
Server-side sort, filter and pagination of the ``/citations`` URL list.

``GET /api/citations`` aggregates every Citations row of a scope into one
entry per distinct URL. A large scope has tens of thousands of URLs (about
18 MB as one response, three times the Lambda cap), so the list is sorted and
filtered here, the way the Citations table offers it, and handed out in pages
(an offset into the sorted list, ``shared.cursors.encode_offset_cursor``).

The orders match the dashboard's former client-side sort exactly: the base
order is most citations first, then most keywords, then URL; a sort column
re-sorts that list stably, so ties keep the base order in both directions.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

SORT_COLUMNS = ('citations', 'keywords', 'domain')
SORT_ORDERS = ('desc', 'asc')
CONTENT_TYPE_FILTERS = ('all', 'video', 'page')

TopUrl = dict[str, Any]


def url_domain(url: str) -> str:
    """The URL's host name, or the URL itself when it has none (the dashboard's ``getDomain``)."""
    try:
        hostname = urlsplit(url).hostname
    except ValueError:
        return url
    return hostname or url


def base_order(top_urls: list[TopUrl]) -> list[TopUrl]:
    """Most citations first, then most keywords, then URL."""
    return sorted(top_urls, key=lambda entry: (-entry['citation_count'], -entry['keyword_count'], entry['url']))


@dataclass(frozen=True)
class CitationQuery:
    """How the caller wants the URL list sorted and filtered."""

    sort: str = 'citations'
    order: str = 'desc'
    url_contains: str = ''
    min_citations: int | None = None
    content_type: str = 'all'

    def matches(self, entry: TopUrl) -> bool:
        if self.url_contains and self.url_contains.lower() not in entry['url'].lower():
            return False
        if self.min_citations is not None and entry['citation_count'] < self.min_citations:
            return False
        return self.content_type == 'all' or entry['content_type'] == self.content_type

    def apply(self, ordered: Sequence[TopUrl]) -> list[TopUrl]:
        """The entries of ``ordered`` (in ``base_order``) that match, in the requested order."""
        matching = [entry for entry in ordered if self.matches(entry)]
        descending = self.order == 'desc'
        if self.sort == 'citations' and descending:
            return matching
        if self.sort == 'keywords':
            # sorted(reverse=True) keeps equal entries in their input order, like a stable JS sort.
            return sorted(matching, key=lambda entry: entry['keyword_count'], reverse=descending)
        if self.sort == 'domain':
            return sorted(matching, key=lambda entry: url_domain(entry['url']), reverse=descending)
        return sorted(matching, key=lambda entry: entry['citation_count'], reverse=descending)


def list_entry(entry: TopUrl, include_keywords: bool) -> TopUrl:
    """A URL as a list page carries it: the keyword texts only when asked for (the Excel export)."""
    if include_keywords:
        return entry
    return {name: value for name, value in entry.items() if name != 'keywords'}
