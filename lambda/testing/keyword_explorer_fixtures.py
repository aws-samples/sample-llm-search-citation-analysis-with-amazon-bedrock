"""The Keyword Explorer filter and sort cases shared with the dashboard (``keyword_explorer_filter_cases.json``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CASES = json.loads((Path(__file__).parent / 'keyword_explorer_filter_cases.json').read_text(encoding='utf-8'))

def filter_rows() -> list[dict[str, Any]]:
    """The research rows every case filters (the API ``KeywordRow`` fields the filters and sort read)."""
    return _CASES['rows']


def filter_cases() -> list[dict[str, Any]]:
    """``{name, filters, sort, keywords}``: the dashboard's filters and sort, and the keywords the table lists."""
    return _CASES['cases']

_QUERY_NAMES = {
    'include': 'include', 'exclude': 'exclude', 'minVolume': 'min_volume', 'maxVolume': 'max_volume',
    'maxDifficulty': 'max_difficulty', 'minCpc': 'min_cpc', 'maxCpc': 'max_cpc',
}


def explorer_query(case: dict[str, Any]) -> dict[str, str]:
    """A case's filters and sort as the cache-only research route's query parameters."""
    filters = case['filters']
    query = {_QUERY_NAMES[name]: value for name, value in filters.items() if name in _QUERY_NAMES}
    if filters.get('intents'):
        query['intents'] = ','.join(filters['intents'])
    return {**query, 'sort': case['sort']['field'], 'direction': case['sort']['direction']}
