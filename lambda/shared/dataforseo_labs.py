"""DataForSEO Labs keyword endpoints (the 94 Labs countries): ``related_keywords``,
``keyword_suggestions``, ``keyword_ideas`` (research) and ``keyword_overview`` (metrics for a
known list). Labs items sit in ``task.result[0].items``.

The research mapper and the ``keyword_overview`` mapper both pick the clickstream block when its
``search_volume is not None``, so a clickstream volume of 0 is kept as 0 rather than falling back to the
Google Ads volume.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Literal

from shared import dataforseo_client
from shared.dataforseo_keyword_rows import (
    KeywordMetric,
    KeywordRow,
    float_or_none,
    int_or_none,
    mapping_or_empty,
    monthly_searches,
    normalize_intent,
    object_list,
    unique_keyword_items,
)
from shared.dataforseo_locations import MarketCodes, keyword_data_language

LabsSource = Literal['related', 'suggestions', 'ideas']

RELATED_PATH = '/v3/dataforseo_labs/google/related_keywords/live'
SUGGESTIONS_PATH = '/v3/dataforseo_labs/google/keyword_suggestions/live'
IDEAS_PATH = '/v3/dataforseo_labs/google/keyword_ideas/live'
OVERVIEW_PATH = '/v3/dataforseo_labs/google/keyword_overview/live'

#: Related keywords are read ``depth: 3`` (the "people also search for" graph three hops out).
RELATED_DEPTH = 3


def research_body(
    source: LabsSource, seed: str, codes: MarketCodes, *, limit: int, ignore_synonyms: bool, clickstream: bool,
) -> dict[str, Any]:
    """The one task of a Labs research call for ``source``."""
    market = {'location_code': codes.location_code, 'language_code': keyword_data_language(codes), 'limit': limit}
    if source == 'related':
        return {
            'keyword': seed, **market, 'depth': RELATED_DEPTH, 'ignore_synonyms': ignore_synonyms,
            'include_clickstream_data': clickstream, 'include_serp_info': False,
        }
    if source == 'suggestions':
        return {
            'keyword': seed, **market, 'include_clickstream_data': clickstream, 'include_serp_info': False,
            'include_seed_keyword': True, 'ignore_synonyms': ignore_synonyms, 'exact_match': False,
        }
    return {
        'keywords': [seed], **market, 'include_clickstream_data': clickstream, 'include_serp_info': False,
        'ignore_synonyms': ignore_synonyms, 'closely_variants': False,
    }


_RESEARCH_PATHS: dict[LabsSource, str] = {
    'related': RELATED_PATH,
    'suggestions': SUGGESTIONS_PATH,
    'ideas': IDEAS_PATH,
}


def labs_items(result: Sequence[Any]) -> list[Mapping[str, Any]]:
    """The JSON objects of ``task.result[0].items`` (none when it is missing)."""
    return object_list(mapping_or_empty(result[0] if result else None).get('items'))


def keyword_info(item: Mapping[str, Any]) -> Mapping[str, Any]:
    """The block volume and trend are read from: clickstream-normalized when it has a volume."""
    clickstream = mapping_or_empty(item.get('keyword_info_normalized_with_clickstream'))
    if clickstream.get('search_volume') is not None:
        return clickstream
    return mapping_or_empty(item.get('keyword_info'))


def _labs_row(keyword: str, item: Mapping[str, Any]) -> KeywordRow:
    info = keyword_info(item)
    paid = mapping_or_empty(item.get('keyword_info'))
    return KeywordRow(
        keyword=keyword,
        search_volume=int_or_none(info.get('search_volume')),
        trend=monthly_searches(info.get('monthly_searches')),
        # CPC and paid competition always come from Google Ads' block, never the clickstream one.
        cpc=float_or_none(paid.get('cpc')),
        competition=float_or_none(paid.get('competition')),
        keyword_difficulty=int_or_none(mapping_or_empty(item.get('keyword_properties')).get('keyword_difficulty')),
        intent=normalize_intent(mapping_or_empty(item.get('search_intent_info')).get('main_intent')),
    )


def map_keyword_data_items(items: Sequence[Mapping[str, Any]]) -> list[KeywordRow]:
    """Normalized, deduped rows; items without a keyword are skipped."""
    return [_labs_row(keyword, item) for keyword, item in unique_keyword_items(items)]


def fetch_research_rows(
    source: LabsSource, seed: str, codes: MarketCodes, *, limit: int, ignore_synonyms: bool, clickstream: bool,
) -> tuple[list[KeywordRow], float]:
    """One Labs research call → (rows, billed USD). Related items wrap the payload in ``keyword_data``."""
    body = research_body(
        source, seed, codes, limit=limit, ignore_synonyms=ignore_synonyms, clickstream=clickstream,
    )
    task = dataforseo_client.post_live(_RESEARCH_PATHS[source], body)
    items = labs_items(task.result)
    if source == 'related':
        items = [data for data in (item.get('keyword_data') for item in items) if isinstance(data, Mapping)]
    return map_keyword_data_items(items), task.cost_usd


def overview_body(keywords: Sequence[str], codes: MarketCodes) -> dict[str, Any]:
    """The ``keyword_overview`` task; metrics refreshes never buy clickstream data."""
    return {
        'keywords': list(keywords),
        'location_code': codes.location_code,
        'language_code': keyword_data_language(codes),
        'include_clickstream_data': False,
    }


def overview_metric(item: Mapping[str, Any], keyword: str) -> KeywordMetric:
    """One ``keyword_overview`` item's metric: ``intent`` stays the raw ``main_intent``."""
    info = mapping_or_empty(item.get('keyword_info'))
    volume_info = keyword_info(item)
    main_intent = mapping_or_empty(item.get('search_intent_info')).get('main_intent')
    level = info.get('competition_level')
    return KeywordMetric(
        keyword=keyword,
        search_volume=int_or_none(volume_info.get('search_volume')),
        monthly_searches=monthly_searches(volume_info.get('monthly_searches')),
        keyword_difficulty=int_or_none(mapping_or_empty(item.get('keyword_properties')).get('keyword_difficulty')),
        cpc=float_or_none(info.get('cpc')),
        competition=float_or_none(info.get('competition')),
        competition_level=level if isinstance(level, str) else None,
        intent=main_intent if isinstance(main_intent, str) else None,
        source='labs',
    )


def fetch_overview_metrics(keywords: Sequence[str], codes: MarketCodes) -> tuple[dict[str, KeywordMetric], float]:
    """One ``keyword_overview`` call (≤ 700 keywords) → (metrics by normalized keyword, billed USD)."""
    task = dataforseo_client.post_live(OVERVIEW_PATH, overview_body(keywords, codes))
    metrics = {keyword: overview_metric(item, keyword) for keyword, item in unique_keyword_items(labs_items(task.result))}
    return metrics, task.cost_usd
