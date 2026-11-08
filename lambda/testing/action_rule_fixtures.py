"""Fixtures for the action-list rules (``shared.citation_gap_rules``, ``prompt_classification``,
``recommendation_rules``, ``competitor_evidence``, ``content_idea_rules``) and their artifacts.

Rows come from ``testing.kpi_row_strategies.search_rows``; ``latest_runs`` keeps each
keyword's latest run, which is what every action list reads.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from random import Random
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from shared.action_scope_serve import live_latest
from shared.partial_contract import KeywordLatest, PartialConfig
from testing.kpi_row_strategies import OWNED_CHOICES, search_rows

#: A tenant with one first-party brand and two competitors (``kpi_row_strategies`` names them).
BASE_BRAND_CONFIG: dict[str, Any] = {
    'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': ['Hotel Mar', 'Parador']},
    'first_party_domains': ['hotel-sol.com'],
    'industry': 'hotels',
}

BRAND_CONFIGS = st.sampled_from(OWNED_CHOICES).map(
    lambda owned: {**BASE_BRAND_CONFIG, 'first_party_domains': list(owned)},
)


def latest_runs(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Each keyword's rows of its latest run, keywords in first-seen order."""
    by_keyword: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_keyword.setdefault(str(row['keyword']), []).append(dict(row))
    latest: dict[str, list[dict[str, Any]]] = {}
    for keyword, keyword_rows in by_keyword.items():
        newest = max(str(row['timestamp']) for row in keyword_rows)
        latest[keyword] = [row for row in keyword_rows if row['timestamp'] == newest]
    return latest


def actions_latest(keyword: str, rows: Sequence[Mapping[str, Any]], brand_config: Mapping[str, Any]) -> KeywordLatest:
    """The KeywordLatest object of one keyword whose latest run is ``rows`` (``actions`` part only)."""
    return live_latest(keyword, rows, PartialConfig(brand_config=brand_config, personas=()), ('actions',))


def scope_latests(rows: Iterable[Mapping[str, Any]], brand_config: Mapping[str, Any]) -> list[KeywordLatest]:
    """The KeywordLatest objects of every keyword ``rows`` hold."""
    return [actions_latest(keyword, run, brand_config) for keyword, run in latest_runs(rows).items()]


def without_ids(items: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """``items`` with their minted ``id`` dropped (ids are random per response)."""
    return [{key: value for key, value in item.items() if key != 'id'} for item in items]


Rows = list[dict[str, Any]]
Config = dict[str, Any]

#: The example budget of the rule property tests.
EXAMPLES = settings(max_examples=100, deadline=None)
#: A few keywords' rows over a few runs, and a tenant's brand configuration.
SCOPES = given(rows=search_rows(max_size=40), config=BRAND_CONFIGS)


def per_keyword(rows: Iterable[Mapping[str, Any]], compute: Callable[[str, Rows, Config], Any], config: Config) -> list[Any]:
    """``compute(keyword, latest run, config)`` of every keyword of ``rows``, the ``None`` results left out."""
    return [value for keyword, run in latest_runs(rows).items() if (value := compute(keyword, run, config)) is not None]


def reordered(items: Iterable[Any], rng: Random) -> list[Any]:
    """``items`` in the order ``rng`` shuffles them to (the original is kept)."""
    shuffled = list(items)
    rng.shuffle(shuffled)
    return shuffled


__all__ = [
    'BASE_BRAND_CONFIG', 'BRAND_CONFIGS', 'EXAMPLES', 'SCOPES', 'Config', 'Rows',
    'actions_latest', 'latest_runs', 'per_keyword', 'reordered', 'scope_latests', 'without_ids',
]
