"""
Tests for get-recommendations.py.

`_annotate_with_status` — the left-join from generated recommendations to
the status table. The helper attaches `id` (deterministic hash) and
`status` to every recommendation. When the status table isn't configured,
every rec defaults to status='new'. When a status row exists, the row's
status, notes, etc. override the default.

`generate_rule_based_recommendations` — the rule set over the latest run
of each keyword: visibility gaps, low rankings, provider gaps, competitor
dominance, and the best-practice fallback, sorted by priority.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.utils import recommendation_id
from testing.env import cleared_env
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


@pytest.fixture
def mod():
    """get-recommendations.py with boto3 patched out at module level."""
    with (
        patch.dict(os.environ, {
            'DYNAMODB_TABLE_SEARCH_RESULTS': 't',
            'DYNAMODB_TABLE_CITATIONS': 't',
            'DYNAMODB_TABLE_CRAWLED_CONTENT': 't',
        }),
        patch('boto3.resource', return_value=MagicMock()),
        patch('boto3.client', return_value=MagicMock()),
    ):
        return load_handler_module(_API_DIR, 'get-recommendations.py')


def _make_rec(rec_type='gap', title='Pitch outdoor publishers', keywords=None):
    return {
        'type': rec_type,
        'priority': 'high',
        'title': title,
        'description': 'd',
        'action': 'a',
        'impact': 'i',
        'keywords': keywords or [],
    }


def _annotate_without_status_table(mod, recs):
    """Run the join with no status table configured."""
    with cleared_env('RECOMMENDATION_STATUS_TABLE'):
        mod._annotate_with_status(recs)


def _annotate_with_status_rows(mod, recs, rows_by_id):
    """Run the join against a status module whose `list_statuses` answers `rows_by_id`.

    `_annotate_with_status` loads `list_statuses` from `recommendation-status.py`
    through `load_sibling_function`; the loader is replaced so the fake is what
    it hands back.
    """
    list_statuses = MagicMock(return_value=rows_by_id)
    with (
        patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}),
        patch.object(mod, 'load_sibling_function', return_value=list_statuses),
    ):
        mod._annotate_with_status(recs)


# --- id annotation -------------------------------------------------------


def test_annotate_attaches_deterministic_id_to_each_rec(mod):
    rec = _make_rec()
    expected = recommendation_id(rec)
    recs = [rec]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['id'] == expected


def test_annotate_assigns_status_new_when_no_status_table_configured(mod):
    recs = [_make_rec()]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['status'] == 'new'


def test_annotate_assigns_distinct_ids_to_recs_with_distinct_titles(mod):
    a = _make_rec(title='A')
    b = _make_rec(title='B')
    recs = [a, b]
    _annotate_without_status_table(mod, recs)
    assert recs[0]['id'] != recs[1]['id']


# --- status join (when table configured) ---------------------------------


def test_annotate_joins_status_row_when_table_returns_match(mod):
    rec = _make_rec(title='Pitch X')
    rec_id = recommendation_id(rec)
    recs = [rec]

    _annotate_with_status_rows(mod, recs, {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'in_progress',
            'notes': 'reaching out next week',
            'updated_at': '2026-05-15T10:00:00Z',
        },
    })

    assert recs[0]['status'] == 'in_progress'
    assert recs[0]['notes'] == 'reaching out next week'


def test_annotate_falls_back_to_new_status_when_join_lookup_fails(mod):
    rec = _make_rec()
    recs = [rec]
    with (
        patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test'}),
        patch.object(mod, 'load_sibling_function', side_effect=ImportError('boom')),
    ):
        mod._annotate_with_status(recs)
    # Even though the env var is set, the broken loader is non-fatal.
    assert recs[0]['status'] == 'new'


def test_annotate_propagates_optional_fields_from_status_row(mod):
    rec = _make_rec(title='Pitch X')
    rec_id = recommendation_id(rec)
    recs = [rec]

    _annotate_with_status_rows(mod, recs, {
        rec_id: {
            'recommendation_id': rec_id,
            'status': 'done',
            'completed_at': '2026-05-15T10:00:00Z',
            'related_keyword': 'best running shoes',
            'related_content_id': 'content-42',
        },
    })

    assert recs[0]['completed_at'] == '2026-05-15T10:00:00Z'
    assert recs[0]['related_keyword'] == 'best running shoes'
    assert recs[0]['related_content_id'] == 'content-42'


def test_annotate_handles_empty_recommendations_list(mod):
    recs = []
    _annotate_without_status_table(mod, recs)
    assert recs == []



# --- rule-based recommendations -------------------------------------------


RULES_CONFIG = {'tracked_brands': {'first_party': ['MyBrand'], 'competitors': ['Rival', 'Other']}}
LATEST_TS = '2026-08-19T00:00:00'
OLDER_TS = '2026-08-01T00:00:00'


def _brand(name, classification, rank):
    return {'name': name, 'classification': classification, 'rank': rank}


def _mine(rank):
    return _brand('MyBrand', 'first_party', rank)


def _rival(rank=1):
    return _brand('Rival', 'competitor', rank)


def _result(keyword, provider, brands, timestamp=LATEST_TS):
    return {'keyword': keyword, 'timestamp': timestamp, 'provider': provider, 'brands': brands}


def _recommend(mod, items, config=RULES_CONFIG):
    """Run the rules over `items` as if the search table had returned them."""
    with patch.object(mod, 'load_recent_search_results', return_value=items):
        return mod.generate_rule_based_recommendations(config)


def _of_type(recs, rec_type):
    return [rec for rec in recs if rec['type'] == rec_type]


def _gemini_omits_brand(keywords):
    """One run per keyword in which OpenAI names the brand and Gemini names only a rival."""
    items = []
    for keyword in keywords:
        items.append(_result(keyword, 'openai', [_mine(1)]))
        items.append(_result(keyword, 'gemini', [_rival()]))
    return items


def test_rules_return_only_the_configuration_recommendation_when_no_first_party_brand_is_configured(mod):
    with patch.object(mod, 'load_recent_search_results') as loader:
        recs = mod.generate_rule_based_recommendations({'tracked_brands': {'competitors': ['Rival']}})

    assert [(rec['type'], rec['priority']) for rec in recs] == [('configuration', 'high')]
    assert recs[0]['title'] == 'Configure First-Party Brands'
    loader.assert_not_called()


def test_rules_return_only_the_first_analysis_recommendation_when_no_search_results_exist(mod):
    recs = _recommend(mod, [])

    assert [(rec['type'], rec['priority']) for rec in recs] == [('data', 'high')]
    assert recs[0]['title'] == 'Run Your First Analysis'


def test_rules_flag_a_visibility_gap_listing_keywords_with_the_most_competitor_mentions_first(mod):
    recs = _recommend(mod, [
        _result('kw-one-rival', 'openai', [_rival()]),
        _result('kw-two-rivals', 'openai', [_rival(1), _brand('Other', 'competitor', 2)]),
    ])

    gap, = _of_type(recs, 'visibility_gap')
    assert gap['title'] == 'Missing from 2 Keywords'
    assert gap['keywords'] == ['kw-two-rivals', 'kw-one-rival']
    assert gap['impact'] == 'Potential to capture 3 competitor mentions'


def test_rules_report_a_low_ranking_when_the_brand_appears_below_position_3(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_rival(1), _mine(4)])])

    ranking, = _of_type(recs, 'ranking')
    assert ranking['priority'] == 'medium'
    assert ranking['title'] == 'Low Rankings on 1 Keywords'
    assert ranking['keywords'] == ['kw (rank 4)']


def test_rules_report_no_low_ranking_when_the_brand_holds_position_3(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_rival(1), _mine(3)])])

    assert _of_type(recs, 'ranking') == []


def test_rules_report_a_provider_gap_when_the_brand_is_missing_on_three_keywords_for_one_provider(mod):
    recs = _recommend(mod, _gemini_omits_brand(('kw-a', 'kw-b', 'kw-c')))

    provider_gap, = _of_type(recs, 'provider_gap')
    assert provider_gap['title'] == 'Not Appearing on Gemini'
    assert provider_gap['keywords'] == ['kw-a', 'kw-b', 'kw-c']
    assert provider_gap['priority'] == 'medium'


def test_rules_report_no_provider_gap_when_the_brand_is_missing_on_only_two_keywords(mod):
    recs = _recommend(mod, _gemini_omits_brand(('kw-a', 'kw-b')))

    assert _of_type(recs, 'provider_gap') == []


def test_rules_report_competitor_dominance_when_competitor_mentions_exceed_the_brand_rank(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_rival(1), _brand('Other', 'competitor', 2), _mine(3)])])

    competitive, = _of_type(recs, 'competitive')
    assert competitive['priority'] == 'high'
    assert competitive['keywords'] == ['kw']


def test_rules_report_no_competitor_dominance_when_the_brand_rank_equals_the_competitor_mentions(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_rival(1), _brand('Other', 'competitor', 3), _mine(2)])])

    assert _of_type(recs, 'competitive') == []


def test_rules_fall_back_to_the_best_practice_recommendation_when_the_brand_leads_everywhere(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_mine(1)])])

    assert [(rec['type'], rec['priority']) for rec in recs] == [('best_practice', 'low')]
    assert recs[0]['title'] == 'Maintain Citation Freshness'


def test_rules_append_the_best_practice_recommendation_when_only_two_rules_fire(mod):
    recs = _recommend(mod, [_result('kw', 'openai', [_rival()])])

    assert [rec['type'] for rec in recs] == ['visibility_gap', 'competitive', 'best_practice']


def test_rules_order_recommendations_by_priority_keeping_rule_order_within_a_priority(mod):
    recs = _recommend(mod, [
        _result('kw-missing', 'openai', [_rival()]),
        _result('kw-low-rank', 'openai', [_mine(5)]),
    ])

    assert [rec['type'] for rec in recs] == ['visibility_gap', 'competitive', 'ranking']
    assert [rec['priority'] for rec in recs] == ['high', 'high', 'medium']


def test_rules_judge_each_keyword_by_its_latest_run_only(mod):
    recs = _recommend(mod, [
        _result('kw', 'openai', [_rival()], timestamp=OLDER_TS),
        _result('kw', 'openai', [_mine(1)]),
    ])

    assert _of_type(recs, 'visibility_gap') == []
    assert [rec['type'] for rec in recs] == ['best_practice']
