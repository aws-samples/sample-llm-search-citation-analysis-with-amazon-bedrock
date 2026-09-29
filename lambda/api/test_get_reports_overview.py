"""
Tests for get-reports-overview.py — the /reports/overview aggregator.

The aggregator composes the trend view (`trends_for_scope` of
get-historical-trends.py) and `generate_rule_based_recommendations`, so the
unit tests verify the payload it builds from them: the KPIs and their change,
the keyword counts and the top movers.

`shared.*` resolves from the source tree via `lambda/conftest.py`, and the
sibling-module loader is pre-filled so no DynamoDB or boto3 client is needed.
"""

import json
import os
from unittest.mock import patch

import pytest

from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


def _keyword_trend(keyword: str, score: float, change: float | None) -> dict:
    """One keyword of the trend view: its latest visibility score and its change (``None``: a single period)."""
    return {
        'keyword': keyword,
        'period': '2026-09-18',
        'kpis': {'visibility_score': score},
        'change': None if change is None else {'previous_period': '2026-09-17', 'deltas': {'visibility_score': change}, 'trends': {}},
    }


LATEST = {'visibility_score': 57.5, 'mention_rate': 62.5}
CHANGE = {'keywords_compared': 3, 'deltas': {'visibility_score': 0.5}, 'trends': {'visibility_score': 'stable'}}

DEFAULT_FAKE_TRENDS = {
    'scope': {'kind': 'all', 'label': 'All keywords', 'keyword_count': 5},
    'keywords_analyzed': 5,
    'keywords_with_data': 5,
    'citations_configured': False,
    'latest': LATEST,
    'change': CHANGE,
    'keyword_trends': [
        _keyword_trend('a', 80, 8),
        _keyword_trend('b', 70, 4),
        _keyword_trend('e', 65, 12),
        _keyword_trend('c', 30, -10),
        _keyword_trend('d', 50, 0),
        _keyword_trend('f', 40, None),
    ],
    'overall': {'improving_count': 3, 'declining_count': 1, 'stable_count': 2},
}

DEFAULT_FAKE_RECS = [
    {'type': 'gap', 'priority': priority, 'title': title, 'description': 'd', 'action': 'a', 'impact': 'i'}
    for priority, title in (('high', 'Top rec'), ('medium', 'Mid rec'), ('low', 'Low rec'), ('low', 'Extra rec'))
]


def _load_overview_module():
    """Load get-reports-overview.py with sibling helpers stubbed out."""
    mod = load_handler_module(_API_DIR, 'get-reports-overview.py')

    # Pre-fill the lazy cache with our fakes so the production
    # _load_sibling code path is never exercised in tests.
    mod._sibling_cache['trends'] = lambda scope, period, days, owned_domains: DEFAULT_FAKE_TRENDS
    mod._sibling_cache['recs'] = lambda config, keywords=None: DEFAULT_FAKE_RECS
    return mod


@pytest.fixture
def overview_mod():
    return _load_overview_module()


def _empty_event():
    return {
        'resource': '/api/reports/overview',
        'path': '/api/reports/overview',
        'httpMethod': 'GET',
        'headers': {'origin': 'http://localhost:3000'},
        'queryStringParameters': None,
    }


# --- top_movers -------------------------------------------------------------


def test_top_movers_ranks_improvers_by_largest_gain(overview_mod):
    improvers, _decliners = overview_mod.top_movers(DEFAULT_FAKE_TRENDS['keyword_trends'], 3)

    assert improvers == [
        {'keyword': 'e', 'visibility_score': 65, 'change': 12},
        {'keyword': 'a', 'visibility_score': 80, 'change': 8},
        {'keyword': 'b', 'visibility_score': 70, 'change': 4},
    ]


def test_top_movers_ranks_decliners_by_largest_loss(overview_mod):
    trends = [*DEFAULT_FAKE_TRENDS['keyword_trends'], _keyword_trend('g', 20, -3)]

    _improvers, decliners = overview_mod.top_movers(trends, 3)

    assert [mover['keyword'] for mover in decliners] == ['c', 'g']


def test_top_movers_caps_both_lists(overview_mod):
    trends = [*DEFAULT_FAKE_TRENDS['keyword_trends'], _keyword_trend('g', 20, -3)]

    improvers, decliners = overview_mod.top_movers(trends, 1)

    assert ([mover['keyword'] for mover in improvers], [mover['keyword'] for mover in decliners]) == (['e'], ['c'])


def test_top_movers_counts_a_change_under_one_point(overview_mod):
    improvers, decliners = overview_mod.top_movers([_keyword_trend('up', 50, 0.5), _keyword_trend('down', 50, -0.5)], 3)

    assert ([mover['keyword'] for mover in improvers], [mover['keyword'] for mover in decliners]) == (['up'], ['down'])


def test_top_movers_leaves_out_unchanged_keywords_and_keywords_with_one_period(overview_mod):
    movers = overview_mod.top_movers([_keyword_trend('d', 50, 0), _keyword_trend('f', 40, None)], 3)

    assert movers == ([], [])


# --- build_overview ---------------------------------------------------------


def test_build_overview_reports_the_latest_kpis_and_their_change(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)

    assert (result['kpis'], result['change']) == (LATEST, CHANGE)


def test_build_overview_reports_the_keyword_counts(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)

    assert (result['keywords_analyzed'], result['keywords_with_data'], result['summary']) == (
        5, 5, {'improving_count': 3, 'declining_count': 1, 'stable_count': 2},
    )


def test_build_overview_lists_the_top_movers(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)

    assert ([mover['keyword'] for mover in result['top_improving']], [mover['keyword'] for mover in result['top_declining']]) == (
        ['e', 'a', 'b'], ['c'],
    )


def test_build_overview_caps_recommendations_at_requested_top_count(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=2)

    assert [recommendation['title'] for recommendation in result['top_recommendations']] == ['Top rec', 'Mid rec']


def test_build_overview_propagates_scope_period_and_days(overview_mod):
    result = overview_mod.build_overview({}, period='week', days=60, top=3)

    assert (result['scope']['kind'], result['period_type'], result['days_analyzed'], result['citations_configured']) == (
        'all', 'week', 60, False,
    )


def test_build_overview_passes_the_owned_domains_to_the_trends(overview_mod):
    seen = {}

    def trends(scope, period, days, owned_domains):
        seen.update(scope=scope, period=period, days=days, owned_domains=owned_domains)
        return DEFAULT_FAKE_TRENDS

    overview_mod._sibling_cache['trends'] = trends
    overview_mod.build_overview({'first_party_domains': ['www.hotel.com']}, period='month', days=90, top=3)

    assert seen == {'scope': None, 'period': 'month', 'days': 90, 'owned_domains': ['hotel.com']}


def test_build_overview_returns_iso_generated_at_with_zulu(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)

    assert result['generated_at'].endswith('Z')


def test_build_overview_has_no_change_before_a_second_period(overview_mod):
    overview_mod._sibling_cache['trends'] = lambda scope, period, days, owned_domains: {
        **DEFAULT_FAKE_TRENDS, 'change': None, 'keyword_trends': [],
    }

    result = overview_mod.build_overview({}, period='day', days=30, top=3)

    assert (result['change'], result['top_improving'], result['top_declining']) == (None, [], [])


# --- handler ----------------------------------------------------------------


def test_handler_returns_200_with_the_overview(overview_mod):
    with patch.object(overview_mod, 'get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)

    body = json.loads(result['body'])
    assert (result['statusCode'], body['kpis'], body['top_improving'][0]['keyword']) == (200, LATEST, 'e')


def test_handler_returns_recommendations_capped_at_default_three(overview_mod):
    with patch.object(overview_mod, 'get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)

    assert len(json.loads(result['body'])['top_recommendations']) == 3


@pytest.mark.parametrize('params', [{'period': 'fortnight'}, {'top': '99'}, {'days': '0'}])
def test_handler_rejects_invalid_parameters(overview_mod, params):
    event = _empty_event()
    event['queryStringParameters'] = params
    with patch.object(overview_mod, 'get_brand_config', return_value={}):
        result = overview_mod.handler(event, None)

    assert result['statusCode'] == 400


# --- _load_sibling + cache-miss paths -------------------------------------


def test_load_sibling_raises_import_error_when_spec_resolution_fails(overview_mod):
    # `spec_from_file_location` returns None for unloadable modules; the
    # loader must surface that as ImportError so callers don't accidentally
    # get a NoneType.exec_module() crash.
    with patch('importlib.util.spec_from_file_location', return_value=None), pytest.raises(ImportError):
        overview_mod._load_sibling('health.py', 'handler')


def test_load_sibling_raises_attribute_error_for_missing_attr(overview_mod):
    # health.py is a sibling that exists but has no `nonexistent_function`.
    with pytest.raises(AttributeError):
        overview_mod._load_sibling('health.py', 'nonexistent_function')


def test_load_sibling_returns_callable_for_valid_sibling_attribute(overview_mod):
    assert callable(overview_mod._load_sibling('health.py', 'handler'))


def test_trends_helper_loads_the_trend_view_of_the_trends_handler(overview_mod):
    overview_mod._sibling_cache.clear()
    sentinel = object()
    overview_mod._load_sibling = lambda filename, attr: (
        (lambda *_a, **_k: sentinel) if (filename, attr) == ('get-historical-trends.py', 'trends_for_scope')
        else (_ for _ in ()).throw(AssertionError(f'unexpected {filename!r} {attr!r}'))
    )

    assert overview_mod._trends_helper()() is sentinel


def test_trends_helper_returns_cached_value_on_subsequent_call(overview_mod):
    overview_mod._sibling_cache.clear()
    sentinel = object()
    overview_mod._load_sibling = lambda *_a, **_k: lambda *_args, **_kwargs: sentinel
    overview_mod._trends_helper()

    def _explode(*_a, **_k):
        raise AssertionError('cache miss on second call')
    overview_mod._load_sibling = _explode

    assert overview_mod._trends_helper()() is sentinel


def test_recs_helper_populates_cache_on_first_call(overview_mod):
    overview_mod._sibling_cache.clear()
    sentinel = ['rec-1']
    overview_mod._load_sibling = lambda filename, attr: (
        (lambda _config: sentinel) if attr == 'generate_rule_based_recommendations'
        else (_ for _ in ()).throw(AssertionError(f'unexpected {attr!r}'))
    )

    assert overview_mod._recs_helper()({}) is sentinel
