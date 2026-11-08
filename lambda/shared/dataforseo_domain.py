"""DataForSEO Labs domain research (``dataforseo_labs/google/*/live``): what one domain ranks for on Google.

* ``domain_overview``: ``domain_rank_overview`` (billed as one row): the domain's organic keyword count, its
  estimated monthly organic traffic (``etv``), what that traffic would cost as ads
  (``estimated_paid_traffic_cost``) and its keywords per position bucket. The endpoint takes no filters, so
  the figures are always domain-wide (the host and its subdomains), whatever the research scope.
* ``ranked_keywords``: one page of the keywords the target ranks for, sorted and filtered by DataForSEO
  (``order_by`` ``"<field>,<asc|desc>"``, ``filters`` from ``dataforseo_domain_scope``).
* ``relevant_pages``: one page of the target's pages by estimated traffic or keyword count.
* ``serp_competitors``: the domains that rank on the same keywords (``organic`` and ``local_pack``).

Every call is billed (Labs: a task fee plus a fee per returned row, priced up front by ``labs_usd(limit)``),
so none is ever re-sent: ``post_live(idempotent=False)`` skips the 5xx retries, since a 5xx does not prove
DataForSEO skipped the charge. Labs does not serve Google-Ads-only countries; ``require_labs`` refuses them
before any call, because DataForSEO bills such a request and then fails it.

Positions: ``position`` is ``rank_absolute`` (every results-page element counted, what DataForSEO sorts and
filters on), ``organic_position`` is ``rank_group`` (organic results only, what users count and what the
AI Overviews engine's organic top 10 reports), falling back to ``rank_absolute`` when absent.
``intent`` is ``keyword_data.search_intent_info.main_intent`` read by ``normalize_intent`` (informational,
commercial, transactional, navigational, else unknown).
``has_more`` comes from the raw item count, before rows without a keyword are dropped, so paging never
stops early.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from shared import dataforseo_client
from shared.dataforseo_domain_scope import (
    KEYWORD_FIELD,
    PAGE_FIELD,
    URL_FIELD,
    ResearchTarget,
    escape_like,
    range_conditions,
    ranked_keywords_scope,
    relevant_pages_scope,
    scoped_expression,
    term_conditions,
)
from shared.dataforseo_keyword_rows import float_or_none, int_or_none, mapping_or_empty, normalize_intent, object_list
from shared.dataforseo_locations import MarketCodes, UnsupportedMarketError, keyword_data_language
from shared.dataforseo_pricing import labs_usd

OVERVIEW_PATH = '/v3/dataforseo_labs/google/domain_rank_overview/live'
RANKED_KEYWORDS_PATH = '/v3/dataforseo_labs/google/ranked_keywords/live'
RELEVANT_PAGES_PATH = '/v3/dataforseo_labs/google/relevant_pages/live'
SERP_COMPETITORS_PATH = '/v3/dataforseo_labs/google/serp_competitors/live'

#: A live Labs call answers well within this; it leaves the router room under API Gateway's 29 s.
LIVE_TIMEOUT_S = 20.0
SERP_COMPETITOR_ITEM_TYPES = ('organic', 'local_pack')

KEYWORD_SORT_FIELDS: dict[str, str] = {
    'rank': 'ranked_serp_element.serp_item.rank_absolute',
    'traffic': 'ranked_serp_element.serp_item.etv',
    'volume': 'keyword_data.keyword_info.search_volume',
    'score': 'keyword_data.keyword_properties.keyword_difficulty',
    'cpc': 'keyword_data.keyword_info.cpc',
}
PAGE_SORT_FIELDS: dict[str, str] = {'traffic': 'metrics.organic.etv', 'keywords': 'metrics.organic.count'}
SORT_ORDERS = ('asc', 'desc')


def order_by(sort_fields: Mapping[str, str], sort: str, order: str) -> list[str]:
    """The one-entry ``order_by`` of a sort mode; an unknown mode or order is a ``ValueError`` (never sent)."""
    if sort not in sort_fields or order not in SORT_ORDERS:
        raise ValueError(f'unknown sort {sort!r} {order!r}')
    return [f'{sort_fields[sort]},{order}']

#: ``(label, DataForSEO metrics.organic fields)`` of each position bucket the overview reports.
POSITION_BUCKETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ('1', ('pos_1',)),
    ('2-3', ('pos_2_3',)),
    ('4-10', ('pos_4_10',)),
    ('11-20', ('pos_11_20',)),
    ('21-50', ('pos_21_30', 'pos_31_40', 'pos_41_50')),
    ('51-100', ('pos_51_60', 'pos_61_70', 'pos_71_80', 'pos_81_90', 'pos_91_100')),
)


def require_labs(codes: MarketCodes) -> None:
    """Refuse a Google-Ads-only market: Labs bills and then fails a request for it."""
    if codes.keyword_data != 'labs':
        raise UnsupportedMarketError('DataForSEO Labs does not serve domain research in this market')


def _market(codes: MarketCodes) -> dict[str, Any]:
    return {'location_code': codes.location_code, 'language_code': keyword_data_language(codes)}


def relative_url(url: str | None) -> str | None:
    """Path and query of ``url`` (``/`` for the root); ``None`` without a URL."""
    if not url:
        return None
    parts = urlsplit(url)
    return f'{parts.path or "/"}{f"?{parts.query}" if parts.query else ""}'


def has_more(offset: int, fetched: int, total_count: int | None, page_size: int) -> bool:
    """Whether another page exists, from the raw provider row count of this one."""
    if total_count is not None:
        return offset + fetched < total_count
    return fetched == page_size


def _result(task: dataforseo_client.TaskResult) -> Mapping[str, Any]:
    return mapping_or_empty(task.result[0] if task.result else None)


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DomainOverview:
    organic_keywords: int | None
    estimated_traffic: int | None
    """Estimated monthly organic visits (DataForSEO ``etv``), rounded: an estimate, never measured clicks."""
    traffic_cost: float | None
    """USD per month the estimated traffic would cost as Google Ads clicks."""
    position_buckets: tuple[tuple[str, int], ...]
    cost_usd: float

    @property
    def has_data(self) -> bool:
        return bool(self.organic_keywords)


def overview_from(item: Mapping[str, Any] | None, cost_usd: float = 0.0) -> DomainOverview:
    """The overview of one ``domain_rank_overview`` item (all ``None`` without one)."""
    organic = mapping_or_empty(mapping_or_empty(mapping_or_empty(item).get('metrics')).get('organic'))
    etv = float_or_none(organic.get('etv'))
    cost = float_or_none(organic.get('estimated_paid_traffic_cost'))
    buckets = tuple(
        (label, sum(int_or_none(organic.get(field)) or 0 for field in fields)) for label, fields in POSITION_BUCKETS
    )
    return DomainOverview(
        organic_keywords=int_or_none(organic.get('count')),
        estimated_traffic=round(etv) if etv is not None else None,
        traffic_cost=round(cost, 2) if cost is not None else None,
        position_buckets=buckets if organic else (),
        cost_usd=cost_usd,
    )


def domain_overview(hostname: str, codes: MarketCodes, *, timeout_s: float = LIVE_TIMEOUT_S) -> DomainOverview:
    """The domain-wide overview of ``hostname`` in one market."""
    require_labs(codes)
    task = dataforseo_client.post_live(
        OVERVIEW_PATH, {'target': hostname, **_market(codes), 'limit': 1}, idempotent=False, timeout_s=timeout_s,
    )
    items = object_list(_result(task).get('items'))
    return overview_from(items[0] if items else None, task.cost_usd)


def overview_cost_usd() -> float:
    return labs_usd(1)


# ---------------------------------------------------------------------------
# Ranked keywords
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class KeywordFilters:
    include: str | None = None
    exclude: str | None = None
    min_volume: float | None = None
    max_volume: float | None = None
    min_traffic: float | None = None
    max_traffic: float | None = None
    min_cpc: float | None = None
    max_cpc: float | None = None
    min_kd: float | None = None
    max_kd: float | None = None
    min_rank: float | None = None
    max_rank: float | None = None


def keyword_filters(filters: KeywordFilters, search: str | None, target: ResearchTarget) -> list[Any]:
    """The ``ranked_keywords`` ``filters`` expression; raises ``FilterBudgetError`` over 8 conditions."""
    conditions: list[Any] = [
        *term_conditions(KEYWORD_FIELD, filters.include, filters.exclude),
        *range_conditions('keyword_data.keyword_info.search_volume', filters.min_volume, filters.max_volume),
        *range_conditions('ranked_serp_element.serp_item.etv', filters.min_traffic, filters.max_traffic),
        *range_conditions('keyword_data.keyword_info.cpc', filters.min_cpc, filters.max_cpc),
        *range_conditions('keyword_data.keyword_properties.keyword_difficulty', filters.min_kd, filters.max_kd),
        *range_conditions('ranked_serp_element.serp_item.rank_absolute', filters.min_rank, filters.max_rank),
    ]
    term = (search or '').strip()
    if term:
        escaped = escape_like(term)
        conditions.append([[KEYWORD_FIELD, 'ilike', f'%{escaped}%'], 'or', [URL_FIELD, 'ilike', f'%{escaped}%']])
    return scoped_expression(ranked_keywords_scope(target), conditions)


@dataclass(frozen=True)
class RankedKeyword:
    keyword: str
    position: int | None
    organic_position: int | None
    search_volume: int | None
    etv: float | None
    cpc: float | None
    keyword_difficulty: int | None
    url: str | None
    relative_url: str | None
    intent: str


def _first(*values: object) -> object:
    """The first value that is not ``None`` (a JSON ``null`` falls through to the next source)."""
    return next((value for value in values if value is not None), None)


def _rounded(value: object) -> int | None:
    number = float_or_none(value)
    return round(number) if number is not None else None


def ranked_keyword_from(item: Mapping[str, Any]) -> RankedKeyword | None:
    """One ``ranked_keywords`` item; ``None`` when it names no keyword."""
    data = mapping_or_empty(item.get('keyword_data'))
    info = mapping_or_empty(data.get('keyword_info'))
    properties = mapping_or_empty(data.get('keyword_properties'))
    element = mapping_or_empty(item.get('ranked_serp_element'))
    serp_item = mapping_or_empty(element.get('serp_item'))
    keyword = data.get('keyword') or item.get('keyword')
    if not isinstance(keyword, str) or not keyword:
        return None
    url = _first(serp_item.get('url'), element.get('url'))
    url_text = url if isinstance(url, str) else None
    position = _rounded(_first(serp_item.get('rank_absolute'), element.get('rank_absolute')))
    group = _rounded(_first(serp_item.get('rank_group'), element.get('rank_group')))
    relative = _first(serp_item.get('relative_url'), element.get('relative_url'))
    return RankedKeyword(
        keyword=keyword,
        position=position,
        organic_position=group if group is not None else position,
        search_volume=_rounded(info.get('search_volume')),
        etv=float_or_none(_first(serp_item.get('etv'), element.get('etv'))),
        cpc=float_or_none(info.get('cpc')),
        keyword_difficulty=_rounded(_first(properties.get('keyword_difficulty'), info.get('keyword_difficulty'))),
        url=url_text,
        relative_url=relative if isinstance(relative, str) else relative_url(url_text),
        intent=normalize_intent(mapping_or_empty(data.get('search_intent_info')).get('main_intent')),
    )


@dataclass(frozen=True)
class Page[T]:
    items: tuple[T, ...]
    total_count: int | None
    has_more: bool
    cost_usd: float


@dataclass(frozen=True)
class PageRequest:
    """One page of a paged Labs list: who, where, which rows and in what order."""

    target: ResearchTarget
    codes: MarketCodes
    limit: int
    offset: int
    order_by: list[str]
    filters: list[Any]
    timeout_s: float


def labs_page[T](path: str, request: PageRequest, mapper: Callable[[Mapping[str, Any]], T | None]) -> Page[T]:
    """POST one page (sent once: billed) and map its rows; ``has_more`` counts the raw rows."""
    body: dict[str, Any] = {
        'target': request.target.hostname, **_market(request.codes), 'limit': request.limit,
        'offset': request.offset, 'order_by': request.order_by,
    }
    if request.filters:
        body['filters'] = request.filters
    task = dataforseo_client.post_live(path, body, idempotent=False, timeout_s=request.timeout_s)
    result = _result(task)
    raw = object_list(result.get('items'))
    total = int_or_none(result.get('total_count'))
    rows = tuple(row for row in map(mapper, raw) if row is not None)
    return Page(items=rows, total_count=total, has_more=has_more(request.offset, len(raw), total, request.limit),
                cost_usd=task.cost_usd)


def ranked_keywords(
    target: ResearchTarget, codes: MarketCodes, *, limit: int, offset: int = 0, sort: str = 'traffic',
    order: str = 'desc', filters: KeywordFilters | None = None, search: str | None = None,
    timeout_s: float = LIVE_TIMEOUT_S,
) -> Page[RankedKeyword]:
    """One page of the keywords ``target`` ranks for (``limit`` rows from ``offset``)."""
    require_labs(codes)
    expression = keyword_filters(filters or KeywordFilters(), search, target)
    request = PageRequest(target, codes, limit, offset, order_by(KEYWORD_SORT_FIELDS, sort, order), expression, timeout_s)
    return labs_page(RANKED_KEYWORDS_PATH, request, ranked_keyword_from)


# ---------------------------------------------------------------------------
# Pages and SERP competitors
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PageFilters:
    include: str | None = None
    exclude: str | None = None
    min_traffic: float | None = None
    max_traffic: float | None = None
    min_keywords: float | None = None
    max_keywords: float | None = None


def page_filters(filters: PageFilters, search: str | None, target: ResearchTarget) -> list[Any]:
    """The ``relevant_pages`` ``filters`` expression; raises ``FilterBudgetError`` over 8 conditions."""
    conditions: list[Any] = [
        *term_conditions(PAGE_FIELD, filters.include, filters.exclude),
        *range_conditions('metrics.organic.etv', filters.min_traffic, filters.max_traffic),
        *range_conditions('metrics.organic.count', filters.min_keywords, filters.max_keywords),
    ]
    term = (search or '').strip()
    if term:
        conditions.append([PAGE_FIELD, 'ilike', f'%{escape_like(term)}%'])
    return scoped_expression(relevant_pages_scope(target), conditions)


@dataclass(frozen=True)
class TopPage:
    url: str
    relative_url: str | None
    etv: float | None
    keywords: int | None


def top_page_from(item: Mapping[str, Any]) -> TopPage | None:
    url = item.get('page_address')
    if not isinstance(url, str) or not url:
        return None
    organic = mapping_or_empty(mapping_or_empty(item.get('metrics')).get('organic'))
    return TopPage(url=url, relative_url=relative_url(url), etv=float_or_none(organic.get('etv')),
                   keywords=int_or_none(organic.get('count')))


def relevant_pages(
    target: ResearchTarget, codes: MarketCodes, *, limit: int, offset: int = 0, sort: str = 'traffic',
    order: str = 'desc', filters: PageFilters | None = None, search: str | None = None,
    timeout_s: float = LIVE_TIMEOUT_S,
) -> Page[TopPage]:
    """One page of ``target``'s pages."""
    require_labs(codes)
    expression = page_filters(filters or PageFilters(), search, target)
    request = PageRequest(target, codes, limit, offset, order_by(PAGE_SORT_FIELDS, sort, order), expression, timeout_s)
    return labs_page(RELEVANT_PAGES_PATH, request, top_page_from)


@dataclass(frozen=True)
class SerpCompetitor:
    domain: str
    avg_position: float | None
    median_position: float | None
    visibility: float | None
    etv: float | None
    keywords_count: int | None


def serp_competitor_from(item: Mapping[str, Any]) -> SerpCompetitor | None:
    domain = item.get('domain')
    if not isinstance(domain, str) or not domain:
        return None
    return SerpCompetitor(
        domain=domain,
        avg_position=float_or_none(item.get('avg_position')),
        median_position=float_or_none(item.get('median_position')),
        visibility=float_or_none(item.get('visibility')),
        etv=float_or_none(item.get('etv')),
        keywords_count=int_or_none(item.get('keywords_count')),
    )


def serp_competitors(
    keywords: Sequence[str], codes: MarketCodes, *, limit: int, include_subdomains: bool = True,
    timeout_s: float = LIVE_TIMEOUT_S,
) -> tuple[tuple[SerpCompetitor, ...], float]:
    """The domains ranking on ``keywords`` and the call's cost, in DataForSEO's order."""
    require_labs(codes)
    body = {
        'keywords': list(keywords), **_market(codes), 'item_types': list(SERP_COMPETITOR_ITEM_TYPES),
        'include_subdomains': include_subdomains, 'limit': limit, 'offset': 0,
    }
    task = dataforseo_client.post_live(SERP_COMPETITORS_PATH, body, idempotent=False, timeout_s=timeout_s)
    rows = tuple(row for row in map(serp_competitor_from, object_list(_result(task).get('items'))) if row is not None)
    return rows, task.cost_usd


__all__ = [
    'DomainOverview',
    'KeywordFilters',
    'Page',
    'PageFilters',
    'RankedKeyword',
    'SerpCompetitor',
    'TopPage',
    'domain_overview',
    'has_more',
    'keyword_filters',
    'overview_cost_usd',
    'page_filters',
    'ranked_keywords',
    'relevant_pages',
    'require_labs',
    'serp_competitors',
]
