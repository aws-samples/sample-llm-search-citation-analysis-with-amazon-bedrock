"""
Export sources of the DataForSEO-paged SEO tables (2.45.0): S34 Domain Overview, S35 Backlinks.

Each replays its SEO route (``POST``, JSON body) against the SEO router
(``seo`` in ``EXPORT_API_FUNCTIONS``) in one of two ways:

- **Priced** (``rows`` and ``price_usd`` given): the first ``rows`` rows of the
  list as the view sorts and filters it, asked in windows of ``offset``/``limit``
  (1,000 rows a request, never past row 10,000). Each window the route has not
  cached is a paid DataForSEO call, so the user confirmed the row count and its
  price in the dashboard before the export was queued; ``validate`` refuses an
  export without them, or whose price is not the one these rows cost now.
  A window is paid at most once: the route caches every window (Labs 12 h,
  Backlinks 6 h) and a chunk that resumes inside a window it read before asks it
  again with ``cached_only`` (``RouteList.reread_flag``), which the route answers
  from its cache or refuses with 409 ``NOT_CACHED``. The export then fails
  instead of paying for the same rows twice.
- **Screen** (``page`` and ``page_size`` given): the page on screen, free. It is
  asked with ``cached_only`` (the route cached it when the page was shown), so
  it can never be a paid call; an expired page fails the export.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

from shared.dataforseo_backlinks import BACKLINKS_ROW_USD, BACKLINKS_TASK_USD
from shared.dataforseo_pricing import LABS_ROW_USD, LABS_TASK_USD
from shared.export_contract import Caller, ExportCursor, ExportRows, ExportRowSource, ExportSheet
from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns
from shared.request_deadline import Deadline

#: The most rows a priced export reads (``seo_export.EXPORT_MAX_ROWS``: DataForSEO's offset paging limit).
EXPORT_MAX_ROWS = 10_000
#: Rows of one window (``seo_export.EXPORT_ROWS_PER_REQUEST``: DataForSEO's largest ``limit``).
ROWS_PER_REQUEST = 1_000
ROWS_PARAM = 'rows'
PRICE_PARAM = 'price_usd'
PAGE_PARAMS = ('page', 'page_size')
CACHED_ONLY = 'cached_only'
#: How far the confirmed price may be from the computed one (float noise of the dashboard's sum).
PRICE_TOLERANCE_USD = 1e-6

WINDOWS = Paging('offset', request_param='offset', limit_param='limit', limit=ROWS_PER_REQUEST, more_key='has_more')
_JSON_PARAMS = ('filters', 'include_spam', *PAGE_PARAMS, CACHED_ONLY)


@dataclass(frozen=True)
class ExportPricing:
    """An endpoint's DataForSEO prices, the ones its answers' ``export`` block shows the dashboard."""

    request_usd: float
    row_usd: float

    def price_usd(self, rows: int) -> float:
        """The most ``rows`` rows can cost: one request per window plus every row (the dashboard's ``exportPlan``)."""
        return math.ceil(rows / ROWS_PER_REQUEST) * self.request_usd + rows * self.row_usd


def confirmation_problem(params: Mapping[str, str], pricing: ExportPricing) -> str | None:
    """The 400 message when ``params`` hold no confirmed row count and price, or a price these rows do not cost."""
    raw_rows = params.get(ROWS_PARAM, '')
    if not raw_rows.isdigit() or not 1 <= int(raw_rows) <= EXPORT_MAX_ROWS:
        return f'{ROWS_PARAM} must be the confirmed row count, a whole number from 1 to {EXPORT_MAX_ROWS:,}'
    try:
        confirmed = float(params.get(PRICE_PARAM, ''))
    except ValueError:
        return f'{PRICE_PARAM} must be the price confirmed for these rows'
    if not math.isfinite(confirmed) or abs(confirmed - pricing.price_usd(int(raw_rows))) > PRICE_TOLERANCE_USD:
        return 'The price of this export is not the one confirmed. Open the export again to see its price.'
    return None


@dataclass(frozen=True)
class PricedSource:
    """
    A paged SEO table's ``ExportRowSource``: the confirmed rows (``priced``) or the page on screen (``screen``).

    Both sources hold the same lists in the same order, so the sheets and the
    cursors are the same whichever reads.
    """

    priced: RouteSource
    screen: RouteSource
    pricing: ExportPricing

    @property
    def view(self) -> str:
        return self.priced.view

    @property
    def sheets(self) -> tuple[ExportSheet, ...]:
        return self.priced.sheets

    def _reading(self, params: Mapping[str, str]) -> RouteSource:
        return self.screen if any(name in params for name in PAGE_PARAMS) else self.priced

    def validate(self, params: Mapping[str, str], caller: Caller) -> str | None:
        source = self._reading(params)
        if source is self.priced:
            problem = confirmation_problem(params, self.pricing)
            if problem:
                return problem
        return source.validate(params, caller)

    def rows(self, params: Mapping[str, str], cursor: ExportCursor | None, deadline: Deadline) -> ExportRows:
        return self._reading(params).rows(params, cursor, deadline)


@dataclass(frozen=True)
class _Table:
    sheet: str
    path: str
    items: str
    columns: tuple[Column, ...]


def _route_list(table: _Table, forwards: tuple[str, ...], *, screen: bool) -> RouteList:
    if screen:
        return RouteList(
            table.sheet, table.columns, 'seo', table.path, table.items, paging=SINGLE, method='POST',
            json_params=_JSON_PARAMS, forwards=(*forwards, *PAGE_PARAMS), fixed={CACHED_ONLY: 'true'}, partial_flags=(),
        )
    return RouteList(
        table.sheet, table.columns, 'seo', table.path, table.items, paging=WINDOWS, method='POST',
        json_params=_JSON_PARAMS, forwards=forwards, max_rows_param=ROWS_PARAM, reread_flag=CACHED_ONLY, partial_flags=(),
    )


def priced_source(view: str, select: str, tables: tuple[_Table, ...], forwards: tuple[str, ...],
                  pricing: ExportPricing) -> PricedSource:
    """The source of ``view``: one list per table (chosen by ``select``), priced and screen."""
    def source(*, screen: bool) -> RouteSource:
        extra = PAGE_PARAMS if screen else (ROWS_PARAM, PRICE_PARAM)
        return RouteSource(
            view=view, lists=tuple(_route_list(table, forwards, screen=screen) for table in tables),
            params=(*forwards, *extra), required=('target', *extra), select=select,
        )

    return PricedSource(source(screen=False), source(screen=True), pricing)


DOMAIN_TABLES = (
    _Table('keywords', '/api/seo/domains/keywords', 'items', columns(
        'Keyword=keyword', 'Intent=intent', 'Position=position', 'Organic position=organic_position',
        'Search volume=search_volume', 'Est. traffic=etv', 'CPC (USD)=cpc', 'Keyword difficulty=keyword_difficulty',
        'URL=url',
    )),
    _Table('pages', '/api/seo/domains/pages', 'items', columns('URL=url', 'Est. traffic=etv', 'Keywords=keywords')),
)
DOMAIN_FORWARDS = ('target', 'scope', 'market_id', 'sort', 'order', 'search', 'filters')

BACKLINKS_TABLES = (
    _Table('backlinks', '/api/seo/backlinks/rows', 'rows', columns(
        'Domain=domain_from', 'Source URL=url_from', 'Target URL=url_to', 'Anchor=anchor', 'Type=item_type',
        'Dofollow=dofollow', 'Rel Attributes=rel_attributes', 'Domain Rank=domain_from_rank',
        'Source Page Rank=page_from_rank', 'Link Rank=rank', 'Spam Score=spam_score', 'First Seen=first_seen',
        'Last Seen=last_seen', 'Lost=is_lost', 'Broken=is_broken', 'Links Count=links_count',
    )),
    _Table('referring_domains', '/api/seo/backlinks/referring-domains', 'rows', columns(
        'Domain=domain', 'Backlinks=backlinks', 'Referring Pages=referring_pages', 'Rank=rank',
        'Spam Score=spam_score', 'First Seen=first_seen', 'Broken Backlinks=broken_backlinks',
        'Broken Pages=broken_pages',
    )),
    _Table('top_pages', '/api/seo/backlinks/top-pages', 'rows', columns(
        'Page=page', 'Backlinks=backlinks', 'Referring Domains=referring_domains', 'Rank=rank',
        'Broken Backlinks=broken_backlinks',
    )),
)
BACKLINKS_FORWARDS = ('target', 'scope', 'sort_field', 'sort_order', 'filters', 'include_spam', 'mode')

LABS_PRICING = ExportPricing(LABS_TASK_USD, LABS_ROW_USD)
BACKLINKS_PRICING = ExportPricing(BACKLINKS_TASK_USD, BACKLINKS_ROW_USD)

SEO_DOMAIN = priced_source('seo-domain', 'table', DOMAIN_TABLES, DOMAIN_FORWARDS, LABS_PRICING)
SEO_BACKLINKS = priced_source('seo-backlinks', 'tab', BACKLINKS_TABLES, BACKLINKS_FORWARDS, BACKLINKS_PRICING)

SOURCES_OF_SEO_PAID: tuple[ExportRowSource, ...] = (SEO_DOMAIN, SEO_BACKLINKS)
