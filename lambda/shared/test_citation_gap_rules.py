"""Tests for shared.citation_gap_rules: one keyword's gaps and a scope's rollup of ``/citation-gaps``.

The oracle is the pre-move ``api/get-citation-gaps.py`` code (``_map_sources_to_brands``,
``_gaps_and_covered_sources`` and the rollup of ``analyze_all_keywords_gaps`` as of
2.44.0, without the DynamoDB reads), kept here until S4 lands. The shared rules
must find the same gaps, covered sources and counts; they only sort list fields
and break the old ties (equal priority and citations) by URL, then keyword.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from shared.brand_visibility import tracked_brand_names
from shared.citation_gap_rules import (
    NO_FIRST_PARTY_ERROR,
    SCOPE_TOP_GAPS,
    classify_latest_run,
    fuzzy_match_brand,
    keyword_gap_entry,
    keyword_gap_result,
    scope_gap_rollup,
)
from shared.constants import priority_rank
from shared.kpi_engine import is_owned_domain, normalize_domain, percent
from shared.utils import extract_domain
from testing.action_rule_fixtures import (
    BASE_BRAND_CONFIG,
    BRAND_CONFIGS,
    EXAMPLES,
    SCOPES,
    Config,
    Rows,
    latest_runs,
    reordered,
)
from testing.kpi_row_strategies import search_rows


def _oracle_fuzzy(brand_name: str, parent: str, tracked_list: list[str]) -> bool:
    brand_lower, parent_lower = brand_name.lower(), (parent or '').lower()
    for tracked in tracked_list:
        tracked_lower = tracked.lower()
        words = set(tracked_lower.split())
        if tracked_lower in brand_lower or brand_lower in tracked_lower:
            return True
        if parent_lower and (tracked_lower in parent_lower or parent_lower in tracked_lower):
            return True
        if any(len(word) > 3 and word in brand_lower for word in words):
            return True
        core = words - {'hotels', 'hotel', 'international', 'group', 'inc', 'corp', 'company'}
        if any(len(word) > 3 and word in brand_lower for word in core):
            return True
    return False


def _oracle_brands(brands: list[dict[str, Any]], fp_list: list[str], comp_list: list[str]) -> tuple[set[str], set[str]]:
    fp, comp = set(), set()
    for brand in brands:
        name, parent, classification = brand.get('name', ''), brand.get('parent_company', ''), brand.get('classification', '')
        if classification == 'first_party':
            fp.add(name)
        elif classification == 'competitor':
            comp.add(name)
        elif _oracle_fuzzy(name, parent, fp_list):
            fp.add(name)
        elif _oracle_fuzzy(name, parent, comp_list):
            comp.add(name)
    return fp, comp


def _oracle_classify(rows: Rows, config: Config) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    fp_list, comp_list = tracked_brand_names(config)
    sources: dict[str, dict[str, Any]] = defaultdict(lambda: {'first_party': set(), 'competitors': set(), 'providers': set(), 'citation_count': 0})
    for item in rows:
        fp, comp = _oracle_brands(item.get('brands', []), fp_list, comp_list)
        for citation in item.get('citations', []):
            source = sources[citation]
            source['providers'].add(item.get('provider', ''))
            source['citation_count'] += 1
            source['domain'] = extract_domain(citation)
            source['first_party'].update(fp)
            source['competitors'].update(comp)
    gaps, covered = [], []
    for url, data in sources.items():
        normalized = normalize_domain(data['domain'])
        if normalized is not None and is_owned_domain(normalized, config.get('first_party_domains') or []):
            continue
        info = {
            'url': url, 'domain': data['domain'], 'citation_count': data['citation_count'],
            'providers': sorted(data['providers']), 'provider_count': len(data['providers']),
            'first_party_brands': sorted(data['first_party']), 'competitor_brands': sorted(data['competitors']),
        }
        if data['competitors'] and not data['first_party']:
            info['priority'] = 'high' if len(data['providers']) >= 2 else 'medium'
            gaps.append(info)
        elif data['first_party']:
            covered.append(info)
    gaps.sort(key=lambda source: (priority_rank(source.get('priority')), -source['citation_count']))
    covered.sort(key=lambda source: -source['citation_count'])
    return gaps, covered, len(sources)


def _comparable(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sources without ``content_type`` (not in the oracle), as an order-free multiset."""
    shaped = [{key: value for key, value in source.items() if key != 'content_type'} for source in sources]
    return sorted(shaped, key=lambda source: str(source['url']))


def _sort_keys(gaps: list[dict[str, Any]]) -> list[tuple[int, int]]:
    return [(priority_rank(gap.get('priority')), -int(gap['citation_count'])) for gap in gaps]


@EXAMPLES
@SCOPES
def test_classify_latest_run_finds_the_pre_move_gaps_and_covered_sources(rows: Rows, config: Config) -> None:
    for run in latest_runs(rows).values():
        gaps, covered, cited = classify_latest_run(run, config)
        oracle_gaps, oracle_covered, oracle_cited = _oracle_classify(run, config)

        assert (_comparable(gaps), _comparable(covered), cited) == (_comparable(oracle_gaps), _comparable(oracle_covered), oracle_cited)


@EXAMPLES
@SCOPES
def test_classify_latest_run_ranks_gaps_in_the_pre_move_order(rows: Rows, config: Config) -> None:
    for run in latest_runs(rows).values():
        assert _sort_keys(classify_latest_run(run, config)[0]) == _sort_keys(_oracle_classify(run, config)[0])


@EXAMPLES
@SCOPES
def test_scope_rollup_totals_match_the_pre_move_rollup(rows: Rows, config: Config) -> None:
    runs = latest_runs(rows)
    oracle = [_oracle_classify(run, config) for run in runs.values()]
    rollup = scope_gap_rollup(entry for keyword, run in runs.items() if (entry := keyword_gap_entry(keyword, run, config)))

    assert (rollup['keywords_analyzed'], rollup['total_gaps'], rollup['total_high_priority']) == (
        len(runs),
        sum(len(gaps) for gaps, _covered, _cited in oracle),
        sum(gap.get('priority') == 'high' for gaps, _covered, _cited in oracle for gap in gaps),
    )


@EXAMPLES
@SCOPES
def test_scope_rollup_top_gaps_hold_the_pre_move_ranking(rows: Rows, config: Config) -> None:
    runs = latest_runs(rows)
    candidates = [gap for run in runs.values() for gap in _oracle_classify(run, config)[0][:5]]
    candidates.sort(key=lambda gap: (priority_rank(gap.get('priority')), -gap['citation_count']))
    rollup = scope_gap_rollup(entry for keyword, run in runs.items() if (entry := keyword_gap_entry(keyword, run, config)))

    assert _sort_keys(rollup['top_gaps']) == _sort_keys(candidates[:SCOPE_TOP_GAPS])


@EXAMPLES
@given(rows=search_rows(max_size=30), config=BRAND_CONFIGS, seed=st.randoms())
def test_scope_rollup_ignores_the_order_keywords_arrive_in(rows: Rows, config: Config, seed: Any) -> None:
    entries = [entry for keyword, run in latest_runs(rows).items() if (entry := keyword_gap_entry(keyword, run, config))]
    shuffled = reordered(entries, seed)

    assert scope_gap_rollup(shuffled) == scope_gap_rollup(entries)


@EXAMPLES
@given(rows=search_rows(min_size=1, max_size=30), config=BRAND_CONFIGS)
def test_keyword_gap_result_summary_counts_every_gap(rows: Rows, config: Config) -> None:
    for keyword, run in latest_runs(rows).items():
        gaps, covered, cited = _oracle_classify(run, config)
        summary = keyword_gap_result(keyword, run[0]['timestamp'], run, config)['summary']

        assert summary == {
            'gap_count': len(gaps), 'covered_count': len(covered),
            'high_priority_gaps': sum(gap.get('priority') == 'high' for gap in gaps),
            'coverage_rate': percent(len(covered), cited) if cited else 0,
        }


def test_keyword_gap_result_refuses_a_tenant_without_first_party_brands() -> None:
    assert keyword_gap_result('spa', '2026-10-01', [], {'tracked_brands': {'competitors': ['Parador']}}) == {'error': NO_FIRST_PARTY_ERROR}


def test_keyword_gap_result_reports_a_keyword_without_rows() -> None:
    assert keyword_gap_result('spa', '', [], BASE_BRAND_CONFIG) == {'error': 'No data found for keyword: spa'}


def test_keyword_gap_entry_is_none_for_a_keyword_without_rows() -> None:
    assert keyword_gap_entry('spa', [], BASE_BRAND_CONFIG) is None


def test_fuzzy_match_finds_a_significant_word_of_the_tracked_name() -> None:
    assert fuzzy_match_brand('Gran Parador de Lugo', '', ['Parador Hotels'])


def test_fuzzy_match_ignores_short_words() -> None:
    assert not fuzzy_match_brand('NH Collection', '', ['Hotel Sol'])


def _entry(keyword: str, *, complete: bool) -> dict:
    summary = {'keyword': keyword, 'gap_count': 1, 'high_priority_gaps': 0, 'coverage_rate': 0}
    gap = {'url': f'https://{keyword}.example/', 'domain': f'{keyword}.example', 'citation_count': 1, 'priority': 'medium', 'keyword': keyword}
    return {'summary': summary, 'top_gaps': [gap], **({'complete': True} if complete else {})}


def test_a_rollup_says_gaps_truncated_when_an_entry_predates_the_full_gap_list() -> None:
    assert scope_gap_rollup([_entry('spa', complete=True), _entry('golf', complete=False)])['gaps_truncated'] is True


def test_a_rollup_of_complete_entries_lists_every_gap() -> None:
    rollup = scope_gap_rollup([_entry('spa', complete=True), _entry('golf', complete=True)])

    assert (rollup['gaps_truncated'], sorted(gap['keyword'] for gap in rollup['gaps'])) == (False, ['golf', 'spa'])
