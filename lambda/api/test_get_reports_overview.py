"""
Tests for get-reports-overview.py — the /reports/overview aggregator.

The aggregator composes existing helpers (`get_all_keywords_trends` and
`generate_rule_based_recommendations`), so the unit tests verify the
*shape* of the resulting payload and the derivation of fields that this
handler computes itself: previous_score, change_percent, trend_direction,
top_improving / top_declining ordering.

Test bootstrap mirrors `test_routers_404.py`: the Lambda layer is mounted
on sys.path so `from shared.* import` resolves to the layer copy, and
the sibling-module loader is monkey-patched so we don't need a real
DynamoDB or boto3 client.
"""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import patch

import pytest

# Mount the shared layer the way the production Lambda does at runtime.
# When the layer hasn't been built locally, fall back to the source tree
# at lambda/ which has the same `shared/` package structure.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)
elif _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

# `shared/__init__.py` re-exports api_response as a function, shadowing the
# submodule. Force-resolve the module so subsequent imports get the module.
_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response


_API_DIR = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------------
# Fakes for the sibling helpers the aggregator composes.
# ----------------------------------------------------------------------

DEFAULT_FAKE_TRENDS = {
    'period_type': 'day',
    'days_analyzed': 30,
    'keywords_analyzed': 4,
    'keyword_trends': [
        {
            'keyword': 'a', 'trend_direction': 'improving',
            'current_score': 80, 'change': 8, 'change_percent': 11.1,
        },
        {
            'keyword': 'b', 'trend_direction': 'improving',
            'current_score': 70, 'change': 4, 'change_percent': 6.1,
        },
        {
            'keyword': 'c', 'trend_direction': 'declining',
            'current_score': 30, 'change': -10, 'change_percent': -25.0,
        },
        {
            'keyword': 'd', 'trend_direction': 'stable',
            'current_score': 50, 'change': 0, 'change_percent': 0.0,
        },
    ],
    'overall': {
        'improving_count': 2, 'declining_count': 1, 'stable_count': 1,
        'avg_score': 57.5,
    },
}

DEFAULT_FAKE_RECS = [
    {
        'type': 'gap', 'priority': 'high', 'title': 'Top rec',
        'description': 'd', 'action': 'a', 'impact': 'i',
    },
    {
        'type': 'gap', 'priority': 'medium', 'title': 'Mid rec',
        'description': 'd', 'action': 'a', 'impact': 'i',
    },
    {
        'type': 'gap', 'priority': 'low', 'title': 'Low rec',
        'description': 'd', 'action': 'a', 'impact': 'i',
    },
    {
        'type': 'gap', 'priority': 'low', 'title': 'Extra rec',
        'description': 'd', 'action': 'a', 'impact': 'i',
    },
]


def _load_overview_module():
    """Load get-reports-overview.py with sibling helpers stubbed out."""
    spec = importlib.util.spec_from_file_location(
        'get_reports_overview_under_test',
        os.path.join(_API_DIR, 'get-reports-overview.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['get_reports_overview_under_test'] = mod
    spec.loader.exec_module(mod)

    # Pre-fill the lazy cache with our fakes so the production
    # _load_sibling code path is never exercised in tests.
    mod._sibling_cache['trends'] = (
        lambda config, period='day', days=30, scope=None: DEFAULT_FAKE_TRENDS
    )
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


# --- build_overview ---------------------------------------------------------


def test_build_overview_picks_top_two_improvers(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert [m['keyword'] for m in result['top_improving']] == ['a', 'b']


def test_build_overview_orders_improvers_by_descending_change(overview_mod):
    # a has change=8, b has change=4 — biggest mover first.
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    changes = [m['change'] for m in result['top_improving']]
    assert changes == [8, 4]


def test_build_overview_picks_negative_movers_in_decliners_list(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert [m['keyword'] for m in result['top_declining']] == ['c']


def test_build_overview_caps_recommendations_at_requested_top_count(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=2)
    assert len(result['top_recommendations']) == 2


def test_build_overview_propagates_overall_score_from_aggregator(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    # Fixture avg_score=57.5 -> rounded to 57.5
    assert result['overall_score'] == 57.5


def test_build_overview_computes_change_as_average_keyword_change(overview_mod):
    # Fixture changes: 8, 4, -10, 0 -> avg = 0.5
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['change'] == 0.5


def test_build_overview_derives_previous_score_from_overall_minus_change(overview_mod):
    # avg_score=57.5, avg_change=0.5 -> previous = 57.0
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['previous_score'] == 57.0


def test_build_overview_marks_trend_direction_improving_when_avg_change_strongly_positive(overview_mod):
    overview_mod._sibling_cache['trends'] = lambda c, period='day', days=30, scope=None: {
        'keywords_analyzed': 1,
        'keyword_trends': [{
            'keyword': 'x', 'trend_direction': 'improving',
            'current_score': 80, 'change': 5, 'change_percent': 6.7,
        }],
        'overall': {
            'improving_count': 1, 'declining_count': 0, 'stable_count': 0,
            'avg_score': 80,
        },
    }
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['trend_direction'] == 'improving'


def test_build_overview_marks_trend_direction_declining_when_avg_change_strongly_negative(overview_mod):
    overview_mod._sibling_cache['trends'] = lambda c, period='day', days=30, scope=None: {
        'keywords_analyzed': 1,
        'keyword_trends': [{
            'keyword': 'x', 'trend_direction': 'declining',
            'current_score': 50, 'change': -10, 'change_percent': -16.7,
        }],
        'overall': {
            'improving_count': 0, 'declining_count': 1, 'stable_count': 0,
            'avg_score': 50,
        },
    }
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['trend_direction'] == 'declining'


def test_build_overview_marks_trend_direction_stable_when_change_within_threshold(overview_mod):
    # Default fixture has avg change 0.5 — within +/-2 threshold => stable.
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['trend_direction'] == 'stable'


def test_build_overview_keeps_all_three_summary_counts(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['summary']['improving_count'] == 2
    assert result['summary']['declining_count'] == 1
    assert result['summary']['stable_count'] == 1


def test_build_overview_propagates_period_and_days_from_inputs(overview_mod):
    result = overview_mod.build_overview({}, period='week', days=60, top=3)
    assert result['period_type'] == 'week'
    assert result['days_analyzed'] == 60


def test_build_overview_returns_iso_generated_at_with_zulu(overview_mod):
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['generated_at'].endswith('Z')


def test_build_overview_handles_empty_keyword_trends(overview_mod):
    overview_mod._sibling_cache['trends'] = lambda c, period='day', days=30, scope=None: {
        'keywords_analyzed': 0, 'keyword_trends': [], 'overall': {},
    }
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['top_improving'] == []
    assert result['top_declining'] == []
    assert result['change'] == 0.0


def test_build_overview_returns_zero_change_percent_when_previous_score_is_zero(overview_mod):
    # If previous_score derives to 0, change_percent should not divide by zero.
    overview_mod._sibling_cache['trends'] = lambda c, period='day', days=30, scope=None: {
        'keywords_analyzed': 0, 'keyword_trends': [], 'overall': {'avg_score': 0},
    }
    result = overview_mod.build_overview({}, period='day', days=30, top=3)
    assert result['change_percent'] == 0.0


# --- handler ----------------------------------------------------------------


def test_handler_returns_200_with_payload(overview_mod):
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)
    assert result['statusCode'] == 200


def test_handler_returns_overview_top_improving_in_payload(overview_mod):
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)
    body = json.loads(result['body'])
    # Verify the payload actually contains the computed top improver.
    assert body['top_improving'][0]['keyword'] == 'a'


def test_handler_returns_overall_score_in_payload(overview_mod):
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)
    body = json.loads(result['body'])
    assert body['overall_score'] == 57.5


def test_handler_returns_recommendations_capped_at_default_three(overview_mod):
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(_empty_event(), None)
    body = json.loads(result['body'])
    # Default `top` is 3, fixture has 4 recommendations.
    assert len(body['top_recommendations']) == 3


def test_handler_rejects_invalid_period(overview_mod):
    event = _empty_event()
    event['queryStringParameters'] = {'period': 'fortnight'}
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(event, None)
    assert result['statusCode'] == 400


def test_handler_rejects_top_outside_allowed_range(overview_mod):
    event = _empty_event()
    event['queryStringParameters'] = {'top': '99'}
    with patch('shared.utils.get_brand_config', return_value={}):
        result = overview_mod.handler(event, None)
    assert result['statusCode'] == 400


# --- _load_sibling + cache-miss paths -------------------------------------


class SiblingLoaderError(Exception):
    """Raised by tests when the sibling-loader path is exercised."""


def test_load_sibling_raises_import_error_when_spec_resolution_fails(overview_mod):
    # `spec_from_file_location` returns None for unloadable modules; the
    # loader must surface that as ImportError so callers don't accidentally
    # get a NoneType.exec_module() crash.
    with patch('importlib.util.spec_from_file_location', return_value=None):
        with pytest.raises(ImportError):
            overview_mod._load_sibling('health.py', 'handler')


def test_load_sibling_raises_attribute_error_for_missing_attr(overview_mod):
    # health.py is a sibling that exists but has no `nonexistent_function`.
    with pytest.raises(AttributeError):
        overview_mod._load_sibling('health.py', 'nonexistent_function')


def test_load_sibling_returns_callable_for_valid_sibling_attribute(overview_mod):
    # health.py exports `handler`. _load_sibling should successfully
    # exec the module and return the function reference.
    fn = overview_mod._load_sibling('health.py', 'handler')
    assert callable(fn)


def test_trends_helper_populates_cache_on_first_call(overview_mod):
    # Empty the cache then prime via a fake _load_sibling so we exercise
    # the cache-miss branch without needing real DynamoDB credentials.
    overview_mod._sibling_cache.clear()
    sentinel = object()
    overview_mod._load_sibling = lambda filename, attr: (
        (lambda *_a, **_k: sentinel) if attr == 'get_all_keywords_trends'
        else (_ for _ in ()).throw(AssertionError(f'unexpected {attr!r}'))
    )
    result = overview_mod._trends_helper()()
    assert result is sentinel


def test_trends_helper_returns_cached_value_on_subsequent_call(overview_mod):
    overview_mod._sibling_cache.clear()
    sentinel = object()
    overview_mod._load_sibling = lambda *_a, **_k: lambda *_args, **_kwargs: sentinel
    overview_mod._trends_helper()  # populate cache
    # Replace loader with one that would raise — proves we hit the cache.

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
