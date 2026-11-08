"""Tests for shared.prompt_classification: the prompt lists of ``/prompt-insights``.

The oracle is the pre-move ``api/get-prompt-insights.py`` code (``_analyze_keyword``
and ``_rank_prompts`` as of 2.44.0), kept here until S4 lands: the shared rules
must classify and count every keyword the way it did, and only add a total
order (score, then keyword) where it left ties to read order.
"""

from __future__ import annotations

from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from shared.dynamo_decimal import to_int
from shared.kpi_engine import percent
from shared.prompt_classification import LIST_KEYS, prompt_record, ranked_prompts, record_order
from shared.search_results import latest_run
from testing.action_rule_fixtures import EXAMPLES, Rows, latest_runs, reordered
from testing.kpi_row_strategies import search_rows

_UNRANKED = 999
RANKED_CASES = given(rows=search_rows(max_size=30), limit=st.integers(min_value=1, max_value=3))
_SCORES = {'winning_prompts': 'score', 'losing_prompts': 'improvement_potential', 'opportunity_prompts': 'opportunity_score'}


def _oracle_side(results: list[dict[str, Any]], wanted: str) -> dict[str, Any]:
    mentions, best, providers = 0, _UNRANKED, set()
    for result in results:
        for brand in result.get('brands', []):
            if brand.get('classification', 'other') == wanted:
                mentions += to_int(brand.get('mention_count'), 1)
                best = min(best, to_int(brand.get('rank'), _UNRANKED))
                providers.add(result.get('provider', ''))
    return {'mentions': mentions, 'best_rank': best, 'providers': providers}


def _oracle_record(keyword: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    latest_ts, latest = latest_run(results)
    total = len(latest)
    fp, comp = _oracle_side(latest, 'first_party'), _oracle_side(latest, 'competitor')
    fp_cov = len(fp['providers']) / total if total > 0 else 0
    comp_cov = len(comp['providers']) / total if total > 0 else 0
    if fp['mentions'] > 0 and fp['best_rank'] <= 3:
        status = {'status': 'winning', 'score': round(fp_cov * 50 + (4 - fp['best_rank']) / 3 * 30 + min(fp['mentions'], 10) / 10 * 20, 1)}
    elif fp['mentions'] == 0 and comp['mentions'] > 0:
        status = {'status': 'opportunity', 'opportunity_score': round(comp_cov * 50 + min(comp['mentions'], 10) / 10 * 50, 1)}
    elif fp['mentions'] == 0 or fp['best_rank'] > 5:
        status = {'status': 'losing', 'improvement_potential': round(100 - fp_cov * 50 - (10 - min(fp['best_rank'], 10)) / 10 * 50, 1)}
    else:
        status = {'status': 'neutral'}

    def side(data: dict[str, Any], cov: float) -> dict[str, Any]:
        return {
            'mentions': data['mentions'], 'best_rank': data['best_rank'] if data['best_rank'] < _UNRANKED else None,
            'provider_coverage': round(cov * 100, 1), 'providers': sorted(data['providers']),
        }

    return {
        'keyword': keyword, 'timestamp': latest_ts, 'first_party': side(fp, fp_cov), 'competitors': side(comp, comp_cov),
        'total_providers': total, **status,
    }


def _oracle_rank(prompts: list[dict[str, Any]], limit: int) -> dict[str, Any]:
    winning = sorted((p for p in prompts if p['status'] in ('winning', 'neutral')), key=lambda x: x.get('score', 0), reverse=True)
    losing = sorted((p for p in prompts if p['status'] == 'losing'), key=lambda x: x.get('improvement_potential', 0), reverse=True)
    opportunity = sorted((p for p in prompts if p['status'] == 'opportunity'), key=lambda x: x.get('opportunity_score', 0), reverse=True)
    return {
        'total_prompts_analyzed': len(prompts),
        'winning_prompts': winning[:limit], 'losing_prompts': losing[:limit], 'opportunity_prompts': opportunity[:limit],
        'summary': {
            'winning_count': len(winning), 'losing_count': len(losing), 'opportunity_count': len(opportunity),
            'win_rate': percent(len(winning), len(prompts)) if prompts else 0,
        },
    }


def _records(rows: Rows) -> list[dict[str, Any]]:
    return [prompt_record(keyword, run[0]['timestamp'], run) for keyword, run in latest_runs(rows).items()]


def _ranked(rows: Rows, limit: int) -> tuple[dict[str, Any], dict[str, Any]]:
    records = _records(rows)
    return ranked_prompts(records, limit), _oracle_rank(records, limit)


def _scores(listed: list[dict[str, Any]], score: str) -> list[float]:
    return [float(record.get(score, 0)) for record in listed]


@EXAMPLES
@given(rows=search_rows(max_size=30))
def test_prompt_record_matches_the_pre_move_classification_of_the_latest_run(rows: Rows) -> None:
    for keyword, run in latest_runs(rows).items():
        assert prompt_record(keyword, run[0]['timestamp'], run) == _oracle_record(keyword, run)


@EXAMPLES
@RANKED_CASES
def test_ranked_prompts_counts_match_the_pre_move_ranking(rows: Rows, limit: int) -> None:
    ranked, oracle = _ranked(rows, limit)

    assert (ranked['summary'], ranked['total_prompts_analyzed']) == (oracle['summary'], oracle['total_prompts_analyzed'])


@EXAMPLES
@RANKED_CASES
def test_ranked_prompts_lists_hold_the_pre_move_scores_in_order(rows: Rows, limit: int) -> None:
    ranked, oracle = _ranked(rows, limit)

    assert {key: _scores(ranked[key], score) for key, score in _SCORES.items()} == {
        key: _scores(oracle[key], score) for key, score in _SCORES.items()
    }


@EXAMPLES
@given(rows=search_rows(max_size=30), seed=st.randoms())
def test_ranked_prompts_ignore_the_order_records_arrive_in(rows: Rows, seed: Any) -> None:
    records = _records(rows)
    shuffled = reordered(records, seed)

    assert ranked_prompts(shuffled, 2) == ranked_prompts(records, 2)


def test_equal_scores_rank_by_keyword_case_insensitively() -> None:
    records = [{'keyword': name, 'status': 'losing', 'improvement_potential': 50.0} for name in ('beta', 'Alpha', 'gamma')]

    assert [record['keyword'] for record in sorted(records, key=record_order)] == ['Alpha', 'beta', 'gamma']


def test_neutral_prompts_are_listed_with_the_winning_ones() -> None:
    neutral = {'keyword': 'spa', 'status': 'neutral'}

    assert ranked_prompts([neutral], 5)[LIST_KEYS['winning']] == [neutral]
