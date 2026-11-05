"""
Aggregation, server-side sort, filter and pagination of the ``/citations`` URL list.

``GET /api/citations`` aggregates every Citations row of a scope into one
entry per distinct URL (``aggregate_citations``); the citation rollup
(``shared.citation_rollup``) runs the same aggregation ahead of time. A large
scope has tens of thousands of URLs (about 18 MB as one response, three times
the Lambda cap), so the list is sorted and filtered here, the way the
Citations table offers it, and handed out in pages (an offset into the sorted
list, ``shared.cursors.encode_offset_cursor``).

The orders match the dashboard's former client-side sort exactly: the base
order is most citations first, then most keywords, then URL; a sort column
re-sorts that list stably, so ties keep the base order in both directions.
``CitationQuery.apply`` takes an ``EntryView`` so the rollup's compact tuples
sort exactly like the live path's dicts.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from operator import itemgetter
from typing import Any
from urllib.parse import urlsplit

from shared.youtube import CONTENT_TYPES, stored_content_type

SORT_COLUMNS = ('citations', 'keywords', 'domain')
SORT_ORDERS = ('desc', 'asc')
CONTENT_TYPE_FILTERS = ('all', 'video', 'page')

TopUrl = dict[str, Any]
BrandTerms = list[dict[str, Any]]


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
class EntryView[EntryT]:
    """How to read the fields a query sorts and filters on from one entry shape."""

    url: Callable[[EntryT], str]
    citation_count: Callable[[EntryT], int]
    keyword_count: Callable[[EntryT], int]
    content_type: Callable[[EntryT], str]
    domain: Callable[[EntryT], str]


DICT_VIEW: EntryView[TopUrl] = EntryView(
    url=itemgetter('url'),
    citation_count=itemgetter('citation_count'),
    keyword_count=itemgetter('keyword_count'),
    content_type=itemgetter('content_type'),
    domain=lambda entry: url_domain(entry['url']),
)
"""The live path's entries: ``TopUrl`` dicts."""


@dataclass(frozen=True)
class CitationQuery:
    """How the caller wants the URL list sorted and filtered."""

    sort: str = 'citations'
    order: str = 'desc'
    url_contains: str = ''
    min_citations: int | None = None
    content_type: str = 'all'

    @property
    def is_base_order(self) -> bool:
        """Whether the answer is the base order, filtered by content type at most (what rollup chunks hold)."""
        return self.sort == 'citations' and self.order == 'desc' and not self.url_contains and self.min_citations is None

    def matches[EntryT](self, entry: EntryT, view: EntryView[EntryT]) -> bool:
        if self.url_contains and self.url_contains.lower() not in view.url(entry).lower():
            return False
        if self.min_citations is not None and view.citation_count(entry) < self.min_citations:
            return False
        return self.content_type == 'all' or view.content_type(entry) == self.content_type

    def apply[EntryT](self, ordered: Sequence[EntryT], view: EntryView[EntryT]) -> list[EntryT]:
        """The entries of ``ordered`` (in ``base_order``) that match, in the requested order."""
        matching = [entry for entry in ordered if self.matches(entry, view)]
        descending = self.order == 'desc'
        if self.sort == 'citations' and descending:
            return matching
        # sorted(reverse=True) keeps equal entries in their input order, like a stable JS sort.
        if self.sort == 'keywords':
            return sorted(matching, key=view.keyword_count, reverse=descending)
        if self.sort == 'domain':
            return sorted(matching, key=view.domain, reverse=descending)
        return sorted(matching, key=view.citation_count, reverse=descending)


def list_entry(entry: TopUrl, include_keywords: bool) -> TopUrl:
    """A URL as a list page carries it: the keyword texts only when asked for (the Excel export)."""
    if include_keywords:
        return entry
    return {name: value for name, value in entry.items() if name != 'keywords'}


def tracked_brand_terms(brand_config: Mapping[str, Any]) -> BrandTerms:
    """The tracked brands of a brand config, each with the lower-case terms its URLs are matched on."""
    tracked_brands = brand_config.get('tracked_brands') or {}
    brands: BrandTerms = []
    for category in ('first_party', 'competitors'):
        for brand in tracked_brands.get(category, []):
            if isinstance(brand, str):
                brands.append({'name': brand, 'terms': [brand.lower()]})
            elif isinstance(brand, dict):
                name = brand.get('name', '')
                aliases = brand.get('aliases', [])
                brands.append({'name': name, 'terms': [name.lower()] + [alias.lower() for alias in aliases]})
    return brands


def detect_brand_in_url(url_lower: str, tracked_brands: BrandTerms) -> str:
    """The first tracked brand one of whose terms the URL contains, else ``'Other'``."""
    for brand in tracked_brands:
        for term in brand['terms']:
            if term and term in url_lower:
                return brand['name']
    return 'Other'


@dataclass
class _UrlTotals:
    total_count: int = 0
    keywords: set[str] = field(default_factory=set)
    provider_counts: Counter[str] = field(default_factory=Counter)
    content_type: str = ''


@dataclass(frozen=True)
class CitationAggregate:
    """A scope's Citations rows as distinct URLs (in ``base_order``) plus the scope-wide counts."""

    top_urls: list[TopUrl]
    row_count: int
    provider_totals: Counter[str]
    brand_mentions: Counter[str]

    def totals(self) -> dict[str, Any]:
        """The scope-wide fields every ``/citations`` page carries, whatever its filters."""
        return {
            'total_citations': self.row_count,
            'total_urls': len(self.top_urls),
            'total_citation_count': sum(entry['citation_count'] for entry in self.top_urls),
            'content_type_counts': content_type_counts(self.top_urls),
            'provider_stats': [{'provider': p, 'citation_count': c} for p, c in self.provider_totals.items()],
            'brand_stats': [{'brand': b, 'mention_count': c} for b, c in self.brand_mentions.items()],
        }


def content_type_counts(top_urls: Iterable[TopUrl]) -> dict[str, int]:
    """Distinct URLs per content type, every type present (``{'video': 2, 'page': 40}``)."""
    counts: dict[str, int] = dict.fromkeys(CONTENT_TYPES, 0)
    for top_url in top_urls:
        counts[top_url['content_type']] += 1
    return counts


def aggregate_citations(rows: Iterable[Mapping[str, Any]], tracked_brands: BrandTerms) -> CitationAggregate:
    """Group Citations rows by ``normalized_url`` across keywords.

    A row carries ``keyword``, ``normalized_url``, ``citation_count``,
    ``citing_providers`` and ``content_type``; rows stored before
    ``content_type`` existed get the type their URL implies
    (``shared.youtube.stored_content_type``). ``provider_totals`` counts rows
    per provider; ``brand_mentions`` sums each URL's citations under the
    brand its URL names (detected once per URL).
    """
    by_url: dict[str, _UrlTotals] = {}
    provider_totals: Counter[str] = Counter()
    row_count = 0
    for row in rows:
        row_count += 1
        url = row.get('normalized_url', '')
        if not url:
            continue
        totals = by_url.get(url)
        if totals is None:
            totals = by_url[url] = _UrlTotals(content_type=stored_content_type(row.get('content_type'), url))
        totals.total_count += int(row.get('citation_count', 0))
        keyword = row.get('keyword', '')
        if keyword:
            totals.keywords.add(keyword)
        for provider in row.get('citing_providers') or ():
            totals.provider_counts[provider] += 1
            provider_totals[provider] += 1

    brand_mentions: Counter[str] = Counter()
    for url, totals in by_url.items():
        brand_mentions[detect_brand_in_url(url.lower(), tracked_brands)] += totals.total_count
    top_urls = base_order([
        {
            'url': url,
            'citation_count': totals.total_count,
            'by_provider': dict(totals.provider_counts),
            'keyword_count': len(totals.keywords),
            'keywords': sorted(totals.keywords),
            'content_type': totals.content_type,
        }
        for url, totals in by_url.items()
    ])
    return CitationAggregate(top_urls, row_count, provider_totals, brand_mentions)
