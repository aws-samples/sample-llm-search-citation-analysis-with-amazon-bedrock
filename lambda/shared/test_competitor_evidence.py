"""Tests for shared.competitor_evidence: per-keyword evidence and the per-competitor rollup of ``/reports/competitor``.

The oracle is the pre-move ``api/get-reports-competitor.py`` composition
(``_brand_ranks``, ``_outranked_row``, ``_exclusive_sources`` and
``_build_competitor_rollup`` as of 2.44.0, without the DynamoDB read), kept
here until S4 lands. The rollup must hold the same rows and counts; it only
breaks the old ties (equal rank delta, equal lift) by keyword.
"""

from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.citation_gap_rules import classify_latest_run
from shared.competitor_evidence import (
    OUTREACH_TARGETS_LIMIT,
    competitor_rollup,
    keyword_evidence,
    outreach_lift,
    unknown_competitor_error,
)
from shared.constants import priority_rank
from testing.action_rule_fixtures import (
    BASE_BRAND_CONFIG,
    BRAND_CONFIGS,
    EXAMPLES,
    Config,
    Rows,
    latest_runs,
    reordered,
)
from testing.kpi_row_strategies import search_rows

_UNRANKED = 999
COMPETITORS = st.sampled_from(('Hotel Mar', 'Parador', 'PARADOR'))
COMPETITOR_CASES = given(rows=search_rows(max_size=40), config=BRAND_CONFIGS, competitor=COMPETITORS)


def _rank(brand: dict[str, Any]) -> int:
    try:
        return int(brand.get('rank') or _UNRANKED)
    except (TypeError, ValueError):
        return _UNRANKED


def _oracle_ranks(rows: Rows) -> dict[str, dict[str, Any]]:
    ranks: dict[str, dict[str, Any]] = {}
    for item in rows:
        for brand in item.get('brands', []) or []:
            name = (brand.get('name') or '').strip().lower()
            if name:
                row = ranks.setdefault(name, {'best_rank': _UNRANKED, 'providers': set()})
                row['best_rank'] = min(row['best_rank'], _rank(brand))
                row['providers'].add(item.get('provider', ''))
    return {name: {'best_rank': data['best_rank'], 'providers': sorted(data['providers'])} for name, data in ranks.items()}


def _oracle_rollup(competitor: str, runs: dict[str, list[dict[str, Any]]], config: Config) -> dict[str, Any]:
    competitor_lc = competitor.lower()
    first_party = [name.lower() for name in config['tracked_brands']['first_party']]
    outranked, sources = [], []
    for keyword, rows in runs.items():
        ranks = _oracle_ranks(rows)
        their = ranks.get(competitor_lc)
        if not their or their['best_rank'] >= _UNRANKED:
            continue
        our = min((ranks[fp]['best_rank'] for fp in first_party if fp in ranks), default=_UNRANKED)
        if their['best_rank'] < our:
            ranked = our < _UNRANKED
            outranked.append({
                'keyword': keyword, 'their_best_rank': their['best_rank'], 'our_best_rank': our if ranked else None,
                'rank_delta': (our - their['best_rank']) if ranked else None, 'providers': their['providers'],
            })
        for gap in classify_latest_run(rows, config)[0]:
            if competitor_lc in [name.lower() for name in gap.get('competitor_brands', [])]:
                lift = outreach_lift(int(gap['citation_count']), int(gap['provider_count']))
                sources.append({'keyword': keyword, 'url': gap['url'], 'priority': gap['priority'], 'lift_score': lift})
    outranked.sort(key=lambda row: row['rank_delta'] if row['rank_delta'] is not None else -1, reverse=True)
    sources.sort(key=lambda source: (-source['lift_score'], priority_rank(source['priority'])))
    return {
        'outranked': outranked, 'count': len(sources), 'high': sum(source['priority'] == 'high' for source in sources),
        'targets': sources[:OUTREACH_TARGETS_LIMIT],
    }


def _evidence(runs: dict[str, list[dict[str, Any]]], config: Config) -> list[dict[str, Any]]:
    return [entry for keyword, rows in runs.items() if (entry := keyword_evidence(keyword, rows, config))]


def _rollups(rows: Rows, config: Config, competitor: str) -> tuple[dict[str, Any], dict[str, Any]]:
    runs = latest_runs(rows)
    return competitor_rollup(competitor, _evidence(runs, config)), _oracle_rollup(competitor, runs, config)


def _by_keyword(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: row['keyword'])


#: What each comparison reads of (rollup, oracle): the same outranked rows, in the same delta order, the same counts, the same targets.
_VIEWS = {
    'outranked': lambda rollup, oracle: (_by_keyword(rollup['outranked_keywords']), _by_keyword(oracle['outranked'])),
    'delta-order': lambda rollup, oracle: ([r['rank_delta'] for r in rollup['outranked_keywords']], [r['rank_delta'] for r in oracle['outranked']]),
    'source-counts': lambda rollup, oracle: ((rollup['exclusive_source_count'], rollup['high_priority_source_count']), (oracle['count'], oracle['high'])),
    'outreach-lift': lambda rollup, oracle: (
        [(t['lift_score'], t['priority']) for t in rollup['outreach_targets']], [(t['lift_score'], t['priority']) for t in oracle['targets']],
    ),
}


@pytest.mark.parametrize('view', list(_VIEWS))
@EXAMPLES
@COMPETITOR_CASES
def test_rollup_matches_the_pre_move_rollup(view: str, rows: Rows, config: Config, competitor: str) -> None:
    ours, theirs = _VIEWS[view](*_rollups(rows, config, competitor))

    assert ours == theirs


@EXAMPLES
@given(rows=search_rows(max_size=40), config=BRAND_CONFIGS, seed=st.randoms())
def test_rollup_ignores_the_order_evidence_arrives_in(rows: Rows, config: Config, seed: Any) -> None:
    evidence = _evidence(latest_runs(rows), config)
    shuffled = reordered(evidence, seed)

    assert competitor_rollup('Parador', shuffled) == competitor_rollup('Parador', evidence)


def test_keyword_evidence_is_none_when_no_configured_competitor_ranks() -> None:
    rows = [{'keyword': 'spa', 'provider': 'openai', 'brands': [{'name': 'Hotel Sol', 'rank': 1}], 'citations': []}]

    assert keyword_evidence('spa', rows, BASE_BRAND_CONFIG) is None


def test_unknown_competitor_lists_the_configured_ones() -> None:
    assert unknown_competitor_error('Ritz', BASE_BRAND_CONFIG) == {
        'error': "Unknown competitor: 'Ritz'", 'configured_competitors': ['Hotel Mar', 'Parador'],
    }


def test_a_configured_competitor_is_known_in_any_case() -> None:
    assert unknown_competitor_error('parador', BASE_BRAND_CONFIG) is None
