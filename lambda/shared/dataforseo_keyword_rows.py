"""Keyword row types and the shared mappers of the DataForSEO keyword endpoints.

Row types of the DataForSEO keyword endpoints and the pieces every mapper shares: keyword
normalization (trimmed, lower-case), the intent normalizer, monthly-search series and the
number guards that keep a malformed wire value from becoming a metric.

The wire is untyped JSON, so every number goes through ``int_or_none`` /
``float_or_none`` (a bool or a string is "no value", never a metric).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Literal

KeywordSourceName = Literal['labs', 'google_ads']


@dataclass(frozen=True)
class MonthlySearch:
    """Searches in one calendar month."""

    year: int
    month: int
    search_volume: int


@dataclass(frozen=True)
class KeywordRow:
    """One keyword idea with its metrics."""

    keyword: str
    search_volume: int | None
    trend: tuple[MonthlySearch, ...]
    keyword_difficulty: int | None
    cpc: float | None
    competition: float | None
    intent: str


@dataclass(frozen=True)
class KeywordMetric:
    """Metrics for one requested keyword."""

    keyword: str
    search_volume: int | None
    monthly_searches: tuple[MonthlySearch, ...]
    keyword_difficulty: int | None
    cpc: float | None
    competition: float | None
    competition_level: str | None
    intent: str | None
    source: KeywordSourceName


def normalize_keyword(text: str) -> str:
    """Trimmed and lower-cased; every row comes back lower-case."""
    return text.strip().lower()


def normalize_intent(raw: object) -> str:
    """DataForSEO ``main_intent`` → the five app intents."""
    if not isinstance(raw, str) or not raw:
        return 'unknown'
    value = raw.lower()
    if 'inform' in value:
        return 'informational'
    if 'commerc' in value:
        return 'commercial'
    if 'transact' in value:
        return 'transactional'
    if 'navig' in value:
        return 'navigational'
    return 'unknown'


def int_or_none(value: object) -> int | None:
    """A wire integer (floats truncated), or ``None`` for null, bools and non-numbers."""
    number = float_or_none(value)
    if number is None or not math.isfinite(number):
        return None
    return value if isinstance(value, int) else int(number)


def float_or_none(value: object) -> float | None:
    """A wire number as ``float``, or ``None`` for null, bools and non-numbers."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def mapping_or_empty(value: object) -> Mapping[str, Any]:
    """``value`` when it is a JSON object, else an empty one, so a missing nested object reads as empty."""
    return value if isinstance(value, Mapping) else {}


def monthly_searches(entries: object) -> tuple[MonthlySearch, ...]:
    """One ``MonthlySearch`` per object entry; a missing year, month or volume reads as 0."""
    if not isinstance(entries, list):
        return ()
    return tuple(
        MonthlySearch(
            year=int_or_none(entry.get('year')) or 0,
            month=int_or_none(entry.get('month')) or 0,
            search_volume=int_or_none(entry.get('search_volume')) or 0,
        )
        for entry in entries
        if isinstance(entry, Mapping)
    )


def item_keyword(item: Mapping[str, Any]) -> str:
    """The normalized ``item.keyword``, or ``''`` when the item has none (the item is skipped)."""
    keyword = item.get('keyword')
    return normalize_keyword(keyword) if isinstance(keyword, str) else ''


def object_list(value: object) -> list[Mapping[str, Any]]:
    """The JSON objects of ``value`` when it is a list (a missing list reads as empty), else ``[]``."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def unique_keyword_items(items: Iterable[Mapping[str, Any]]) -> Iterator[tuple[str, Mapping[str, Any]]]:
    """``(normalized keyword, item)`` of the first item per keyword; items without a keyword are skipped."""
    seen: set[str] = set()
    for item in items:
        keyword = item_keyword(item)
        if keyword and keyword not in seen:
            seen.add(keyword)
            yield keyword, item


def null_metric(keyword: str, source: KeywordSourceName) -> KeywordMetric:
    """The all-``None`` metric of a requested keyword the provider returned nothing for."""
    return KeywordMetric(
        keyword=keyword,
        search_volume=None,
        monthly_searches=(),
        keyword_difficulty=None,
        cpc=None,
        competition=None,
        competition_level=None,
        intent=None,
        source=source,
    )
