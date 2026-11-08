"""DataForSEO Google Ads keyword data: research and metrics for countries Labs does not serve.

Google Ads keyword data for the 49 countries Labs does not serve: ``keywords_for_keywords``
(research) and ``search_volume`` (metrics for a known list). Items sit directly in ``task.result``,
not in ``task.result[0].items`` as in Labs. Ads has no keyword difficulty or intent; its ``competition`` is a
LOW/MEDIUM/HIGH bucket, so the 0-1 ratio is ``competition_index / 100``.

Google Ads fails the whole ``search_volume`` task on one keyword with a symbol or an emoji, over
80 characters or over 10 words, so ``ads_acceptable`` filters first.

Python's ``re`` has no ``\\p{Extended_Pictographic}``; ``_PICTOGRAPHIC_RANGES`` lists that
Unicode property's code point ranges (emoji-data.txt) instead.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from shared import dataforseo_client
from shared.dataforseo_keyword_rows import (
    KeywordMetric,
    KeywordRow,
    float_or_none,
    int_or_none,
    monthly_searches,
    object_list,
    unique_keyword_items,
)
from shared.dataforseo_locations import MarketCodes, keyword_data_language

SEARCH_VOLUME_PATH = '/v3/keywords_data/google_ads/search_volume/live'
KEYWORDS_FOR_KEYWORDS_PATH = '/v3/keywords_data/google_ads/keywords_for_keywords/live'

ADS_MAX_KEYWORD_LENGTH = 80
ADS_MAX_KEYWORD_WORDS = 10
_ADS_INVALID_CHARS = re.compile(r'[!@%,*(){}<>|^~;=?`]')
_PICTOGRAPHIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x00A9, 0x00A9), (0x00AE, 0x00AE), (0x203C, 0x203C), (0x2049, 0x2049), (0x2122, 0x2122),
    (0x2139, 0x2139), (0x2194, 0x2199), (0x21A9, 0x21AA), (0x231A, 0x231B), (0x2328, 0x2328),
    (0x2388, 0x2388), (0x23CF, 0x23CF), (0x23E9, 0x23F3), (0x23F8, 0x23FA), (0x24C2, 0x24C2),
    (0x25AA, 0x25AB), (0x25B6, 0x25B6), (0x25C0, 0x25C0), (0x25FB, 0x25FE), (0x2600, 0x2605),
    (0x2607, 0x2612), (0x2614, 0x2685), (0x2690, 0x2705), (0x2708, 0x2712), (0x2714, 0x2714),
    (0x2716, 0x2716), (0x271D, 0x271D), (0x2721, 0x2721), (0x2728, 0x2728), (0x2733, 0x2734),
    (0x2744, 0x2744), (0x2747, 0x2747), (0x274C, 0x274C), (0x274E, 0x274E), (0x2753, 0x2755),
    (0x2757, 0x2757), (0x2763, 0x2767), (0x2795, 0x2797), (0x27A1, 0x27A1), (0x27B0, 0x27B0),
    (0x27BF, 0x27BF), (0x2934, 0x2935), (0x2B05, 0x2B07), (0x2B1B, 0x2B1C), (0x2B50, 0x2B50),
    (0x2B55, 0x2B55), (0x3030, 0x3030), (0x303D, 0x303D), (0x3297, 0x3297), (0x3299, 0x3299),
    (0x1F000, 0x1F0FF), (0x1F10D, 0x1F10F), (0x1F12F, 0x1F12F), (0x1F16C, 0x1F171), (0x1F17E, 0x1F17F),
    (0x1F18E, 0x1F18E), (0x1F191, 0x1F19A), (0x1F1AD, 0x1F1E5), (0x1F201, 0x1F20F), (0x1F21A, 0x1F21A),
    (0x1F22F, 0x1F22F), (0x1F232, 0x1F23A), (0x1F23C, 0x1F23F), (0x1F249, 0x1F3FA), (0x1F400, 0x1F53D),
    (0x1F546, 0x1F64F), (0x1F680, 0x1F6FF), (0x1F774, 0x1F77F), (0x1F7D5, 0x1F7FF), (0x1F80C, 0x1F80F),
    (0x1F848, 0x1F84F), (0x1F85A, 0x1F85F), (0x1F888, 0x1F88F), (0x1F8AE, 0x1F8FF), (0x1F90C, 0x1F93A),
    (0x1F93C, 0x1F945), (0x1F947, 0x1FAFF), (0x1FC00, 0x1FFFD),
)


def _is_pictographic(char: str) -> bool:
    code = ord(char)
    return any(low <= code <= high for low, high in _PICTOGRAPHIC_RANGES)


def ads_acceptable(keyword: str) -> bool:
    """Whether Google Ads ``search_volume`` accepts this keyword text."""
    return (
        len(keyword) <= ADS_MAX_KEYWORD_LENGTH
        and len(re.split(r'\s+', keyword)) <= ADS_MAX_KEYWORD_WORDS
        and _ADS_INVALID_CHARS.search(keyword) is None
        and not any(_is_pictographic(char) for char in keyword)
    )


def ads_items(result: Sequence[Any]) -> list[Mapping[str, Any]]:
    """Keywords-data items as a list (a missing result reads as empty): they have no ``items`` wrapper."""
    return object_list(list(result))


def _competition_ratio(item: Mapping[str, Any]) -> float | None:
    index = float_or_none(item.get('competition_index'))
    return index / 100 if index is not None else None


def _ads_row(keyword: str, item: Mapping[str, Any]) -> KeywordRow:
    return KeywordRow(
        keyword=keyword,
        search_volume=int_or_none(item.get('search_volume')),
        trend=monthly_searches(item.get('monthly_searches')),
        cpc=float_or_none(item.get('cpc')),
        competition=_competition_ratio(item),
        keyword_difficulty=None,
        intent='unknown',
    )


def map_ads_keyword_items(items: Sequence[Mapping[str, Any]]) -> list[KeywordRow]:
    """Deduped rows without keyword difficulty, intent ``unknown``."""
    return [_ads_row(keyword, item) for keyword, item in unique_keyword_items(items)]


def fetch_ads_research_rows(seed: str, codes: MarketCodes, *, limit: int) -> tuple[list[KeywordRow], float]:
    """``keywords_for_keywords`` for one seed → (rows, billed USD).

    The endpoint has no limit parameter (thousands of rows for one flat fee), so items are cut to
    ``limit`` before mapping.
    """
    body = {
        'keywords': [seed],
        'location_code': codes.location_code,
        'language_code': keyword_data_language(codes),
        'sort_by': 'search_volume',
    }
    task = dataforseo_client.post_live(KEYWORDS_FOR_KEYWORDS_PATH, body)
    return map_ads_keyword_items(ads_items(task.result)[:limit]), task.cost_usd


def ads_metric(item: Mapping[str, Any], keyword: str) -> KeywordMetric:
    """One known keyword's metric: ``competition_level`` is Ads' bucket, intent ``None``."""
    level = item.get('competition')
    return KeywordMetric(
        keyword=keyword,
        search_volume=int_or_none(item.get('search_volume')),
        monthly_searches=monthly_searches(item.get('monthly_searches')),
        keyword_difficulty=None,
        cpc=float_or_none(item.get('cpc')),
        competition=_competition_ratio(item),
        competition_level=level if isinstance(level, str) else None,
        intent=None,
        source='google_ads',
    )


def fetch_search_volume_metrics(
    keywords: Sequence[str], codes: MarketCodes,
) -> tuple[dict[str, KeywordMetric], float]:
    """``search_volume`` for the Ads-acceptable keywords → (metrics by normalized keyword, billed USD).

    No call (and no cost) when none is acceptable. National only: no ``location_name``.
    """
    accepted = [keyword for keyword in keywords if ads_acceptable(keyword)]
    if not accepted:
        return {}, 0.0
    body = {'keywords': accepted, 'location_code': codes.location_code, 'language_code': keyword_data_language(codes)}
    task = dataforseo_client.post_live(SEARCH_VOLUME_PATH, body)
    metrics = {keyword: ads_metric(item, keyword) for keyword, item in unique_keyword_items(ads_items(task.result))}
    return metrics, task.cost_usd
