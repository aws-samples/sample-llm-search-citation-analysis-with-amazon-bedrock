"""
Tests for get-reports-competitor.py — the /reports/competitor rollup.

Strategy mirrors test_get_reports_overview.py: load the module after
mounting the shared layer / lambda source tree, then prime the lazy
sibling cache and the per-keyword rank lookup with stubs so we never
touch DynamoDB.
"""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Mount shared layer / fall back to lambda/ source.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)
elif _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response

_API_DIR = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------

DEFAULT_RANKS = {
    'best running shoes': {
        'nike': {'best_rank': 2, 'providers': ['openai'], 'classification': 'first_party'},
        'adidas': {'best_rank': 1, 'providers': ['openai', 'perplexity'], 'classification': 'competitor'},
        'asics': {'best_rank': 5, 'providers': ['gemini'], 'classification': 'competitor'},
    },
    'best hiking boots': {
        'nike': {'best_rank': 6, 'providers': ['openai'], 'classification': 'first_party'},
        'adidas': {'best_rank': 8, 'providers': ['openai'], 'classification': 'competitor'},
        'merrell': {'best_rank': 1, 'providers': ['claude'], 'classification': 'competitor'},
    },
    'untouched': {},
}

DEFAULT_GAPS = {
    'best running shoes': {
        'gaps': [
            {
                'url': 'https://example.com/shoes-review',
                'domain': 'example.com',
                'priority': 'high',
                'citation_count': 9,
                'provider_count': 3,
                'providers': ['openai', 'perplexity', 'gemini'],
                'competitor_brands': ['Adidas'],
            },
            {
                'url': 'https://other.com/asics',
                'domain': 'other.com',
                'priority': 'medium',
                'citation_count': 4,
                'provider_count': 2,
                'providers': ['gemini', 'claude'],
                'competitor_brands': ['Asics'],
            },
        ],
    },
    'best hiking boots': {
        'gaps': [
            {
                'url': 'https://outside.com/merrell',
                'domain': 'outside.com',
                'priority': 'high',
                'citation_count': 12,
                'provider_count': 4,
                'providers': ['openai', 'perplexity', 'gemini', 'claude'],
                'competitor_brands': ['Merrell'],
            },
        ],
    },
}


def _load_module():
    """Load get-reports-competitor.py with stubs primed in caches."""
    spec = importlib.util.spec_from_file_location(
        'get_reports_competitor_under_test',
        os.path.join(_API_DIR, 'get-reports-competitor.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['get_reports_competitor_under_test'] = mod
    spec.loader.exec_module(mod)

    mod._sibling_cache['gap'] = lambda keyword, config: DEFAULT_GAPS.get(keyword, {})
    mod._latest_brand_ranks = lambda keyword: DEFAULT_RANKS.get(keyword, {})
    mod._list_tracked_keywords = lambda limit: list(DEFAULT_RANKS.keys())[:limit]
    return mod


@pytest.fixture
def mod():
    return _load_module()


def _load_module_without_stubs():
    """Load module without priming the helper stubs — for testing the
    real DynamoDB-backed _list_tracked_keywords / _latest_brand_ranks."""
    spec = importlib.util.spec_from_file_location(
        'get_reports_competitor_unstubbed',
        os.path.join(_API_DIR, 'get-reports-competitor.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['get_reports_competitor_unstubbed'] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def raw_mod():
    return _load_module_without_stubs()


CONFIG = {
    'tracked_brands': {
        'first_party': ['Nike'],
        'competitors': ['Adidas', 'Asics', 'Merrell', 'Brooks'],
    },
}


def _event(competitor=None, keyword_limit=None):
    qs = {}
    if competitor is not None:
        qs['competitor'] = competitor
    if keyword_limit is not None:
        qs['keyword_limit'] = str(keyword_limit)
    return {
        'resource': '/api/reports/competitor',
        'path': '/api/reports/competitor',
        'httpMethod': 'GET',
        'headers': {'origin': 'http://localhost:3000'},
        'queryStringParameters': qs or None,
    }


# --- _outreach_lift -------------------------------------------------------


def test_outreach_lift_grows_with_provider_count(mod):
    a = mod._outreach_lift(citation_count=5, provider_count=1)
    b = mod._outreach_lift(citation_count=5, provider_count=4)
    assert b > a


def test_outreach_lift_grows_with_citation_count(mod):
    a = mod._outreach_lift(citation_count=2, provider_count=2)
    b = mod._outreach_lift(citation_count=20, provider_count=2)
    assert b > a


def test_outreach_lift_handles_zero_citations_without_blowing_up(mod):
    out = mod._outreach_lift(citation_count=0, provider_count=1)
    assert out >= 0


# --- _build_competitor_rollup --------------------------------------------


def test_rollup_picks_keywords_where_competitor_outranks_first_party(mod):
    keywords = ['best running shoes', 'best hiking boots']
    rollup = mod._build_competitor_rollup('Adidas', keywords, CONFIG)
    keywords_outranked = [r['keyword'] for r in rollup['outranked_keywords']]
    assert 'best running shoes' in keywords_outranked


def test_rollup_excludes_keywords_where_first_party_already_wins(mod):
    keywords = ['best running shoes', 'best hiking boots']
    rollup = mod._build_competitor_rollup('Adidas', keywords, CONFIG)
    keywords_outranked = [r['keyword'] for r in rollup['outranked_keywords']]
    # Adidas is rank 8 on hiking boots, Nike is rank 6 — Adidas does NOT outrank
    assert 'best hiking boots' not in keywords_outranked


def test_rollup_records_their_best_rank_and_our_best_rank(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas', ['best running shoes'], CONFIG,
    )
    row = rollup['outranked_keywords'][0]
    # Fixture: Adidas best=1, Nike best=2.
    assert row['their_best_rank'] == 1
    assert row['our_best_rank'] == 2


def test_rollup_records_rank_delta_as_their_minus_our(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas', ['best running shoes'], CONFIG,
    )
    row = rollup['outranked_keywords'][0]
    # delta = our(2) - their(1) = 1
    assert row['rank_delta'] == 1


def test_rollup_records_providers_for_outranked_row(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas', ['best running shoes'], CONFIG,
    )
    row = rollup['outranked_keywords'][0]
    assert row['providers'] == ['openai', 'perplexity']


def test_rollup_finds_exclusive_sources_for_named_competitor(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas',
        ['best running shoes', 'best hiking boots'],
        CONFIG,
    )
    urls = [s['url'] for s in rollup['exclusive_sources']]
    assert 'https://example.com/shoes-review' in urls


def test_rollup_propagates_priority_and_lift_for_exclusive_source(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas', ['best running shoes'], CONFIG,
    )
    source = rollup['exclusive_sources'][0]
    assert source['priority'] == 'high'
    # provider_count=3, citation_count=9, lift = 3 * log(10) ~= 6.91
    assert source['lift_score'] > 0


def test_rollup_skips_sources_naming_other_competitors(mod):
    rollup = mod._build_competitor_rollup(
        'Adidas',
        ['best running shoes', 'best hiking boots'],
        CONFIG,
    )
    urls = [s['url'] for s in rollup['exclusive_sources']]
    # Asics-only and Merrell-only sources should not be in Adidas's rollup
    assert 'https://other.com/asics' not in urls
    assert 'https://outside.com/merrell' not in urls


def test_rollup_orders_outreach_targets_by_lift_score_descending(mod):
    # Build a fixture with 3 sources of different lift scores so ordering
    # is meaningfully tested (the default fixture only has 1 per keyword).
    mod._sibling_cache['gap'] = lambda keyword, config: {
        'gaps': [
            {
                'url': 'https://low.com', 'domain': 'low.com',
                'priority': 'low', 'citation_count': 1, 'provider_count': 1,
                'providers': ['openai'], 'competitor_brands': ['Adidas'],
            },
            {
                'url': 'https://high.com', 'domain': 'high.com',
                'priority': 'high', 'citation_count': 20, 'provider_count': 4,
                'providers': ['openai', 'p', 'g', 'c'], 'competitor_brands': ['Adidas'],
            },
            {
                'url': 'https://mid.com', 'domain': 'mid.com',
                'priority': 'medium', 'citation_count': 5, 'provider_count': 2,
                'providers': ['openai', 'g'], 'competitor_brands': ['Adidas'],
            },
        ],
    } if keyword == 'kw' else {'gaps': []}
    mod._latest_brand_ranks = lambda keyword: {
        'adidas': {
            'best_rank': 1, 'providers': ['openai'],
            'classification': 'competitor',
        },
        'nike': {
            'best_rank': 5, 'providers': ['openai'],
            'classification': 'first_party',
        },
    }
    rollup = mod._build_competitor_rollup('Adidas', ['kw'], CONFIG)
    targets = rollup['outreach_targets']
    assert targets[0]['url'] == 'https://high.com'
    assert targets[-1]['url'] == 'https://low.com'


def test_rollup_caps_outreach_targets_at_ten_when_more_exist(mod):
    # Generate 15 distinct sources for one keyword so the cap kicks in.
    sources = [
        {
            'url': f'https://s{i}.com', 'domain': f's{i}.com',
            'priority': 'high', 'citation_count': i + 1, 'provider_count': 2,
            'providers': ['openai', 'g'], 'competitor_brands': ['Adidas'],
        }
        for i in range(15)
    ]
    mod._sibling_cache['gap'] = lambda keyword, config: {'gaps': sources}
    mod._latest_brand_ranks = lambda keyword: {
        'adidas': {
            'best_rank': 1, 'providers': ['openai'],
            'classification': 'competitor',
        },
        'nike': {
            'best_rank': 5, 'providers': ['openai'],
            'classification': 'first_party',
        },
    }
    rollup = mod._build_competitor_rollup('Adidas', ['kw'], CONFIG)
    assert len(rollup['outreach_targets']) == 10


# --- build_competitor_rollups (top level) --------------------------------


def test_build_returns_404_payload_for_unknown_competitor(mod):
    payload = mod.build_competitor_rollups(
        CONFIG, competitor='Unknown', keyword_limit=10,
    )
    assert 'error' in payload


def test_build_returns_single_rollup_for_known_competitor(mod):
    payload = mod.build_competitor_rollups(
        CONFIG, competitor='Adidas', keyword_limit=10,
    )
    assert payload['competitor'] == 'Adidas'
    assert 'rollup' in payload


def test_build_returns_all_rollups_when_competitor_omitted(mod):
    payload = mod.build_competitor_rollups(
        CONFIG, competitor=None, keyword_limit=10,
    )
    competitors_in_payload = [r['competitor'] for r in payload['rollups']]
    assert competitors_in_payload == ['Adidas', 'Asics', 'Merrell', 'Brooks']


def test_build_propagates_configured_competitors_in_top_level_list(mod):
    payload = mod.build_competitor_rollups(
        CONFIG, competitor=None, keyword_limit=10,
    )
    assert payload['competitors'] == ['Adidas', 'Asics', 'Merrell', 'Brooks']


def test_build_records_keywords_analyzed_count(mod):
    payload = mod.build_competitor_rollups(
        CONFIG, competitor='Adidas', keyword_limit=2,
    )
    assert payload['keywords_analyzed'] == 2


# --- handler -------------------------------------------------------------


def test_handler_returns_200_for_valid_competitor(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(competitor='Adidas'), None)
    assert result['statusCode'] == 200


def test_handler_returns_single_rollup_payload_for_named_competitor(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(competitor='Adidas'), None)
    body = json.loads(result['body'])
    assert body['competitor'] == 'Adidas'
    assert body['rollup']['competitor'] == 'Adidas'


def test_handler_includes_outranked_keywords_in_payload(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(competitor='Adidas'), None)
    body = json.loads(result['body'])
    keywords_outranked = [
        r['keyword'] for r in body['rollup']['outranked_keywords']
    ]
    assert 'best running shoes' in keywords_outranked


def test_handler_returns_400_for_unconfigured_competitor(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(competitor='Unknown'), None)
    assert result['statusCode'] == 400


def test_handler_rejects_keyword_limit_above_max(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(keyword_limit=999), None)
    assert result['statusCode'] == 400


def test_handler_rejects_keyword_limit_below_min(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(keyword_limit=0), None)
    assert result['statusCode'] == 400


def test_handler_returns_all_rollups_payload_when_competitor_omitted(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(), None)
    body = json.loads(result['body'])
    assert 'rollups' in body
    assert len(body['rollups']) == 4


def test_handler_returns_iso_generated_at_with_zulu(mod):
    with patch('shared.utils.get_brand_config', return_value=CONFIG):
        result = mod.handler(_event(competitor='Adidas'), None)
    body = json.loads(result['body'])
    assert body['generated_at'].endswith('Z')


# --- _load_sibling + cache helpers ----------------------------------------


def test_load_sibling_raises_import_error_when_spec_resolution_fails(mod):
    with patch('importlib.util.spec_from_file_location', return_value=None):
        with pytest.raises(ImportError):
            mod._load_sibling('health.py', 'handler')


def test_load_sibling_raises_attribute_error_for_missing_attr(mod):
    with pytest.raises(AttributeError):
        mod._load_sibling('health.py', 'nonexistent_function')


def test_load_sibling_returns_callable_for_valid_attribute(mod):
    fn = mod._load_sibling('health.py', 'handler')
    assert callable(fn)


def test_gap_helper_populates_cache_on_first_call(mod):
    mod._sibling_cache.clear()
    sentinel = object()
    mod._load_sibling = lambda filename, attr: (
        (lambda *_a, **_k: sentinel) if attr == 'analyze_citation_gaps'
        else (_ for _ in ()).throw(AssertionError(f'unexpected {attr!r}'))
    )
    assert mod._gap_helper()() is sentinel


def test_gap_helper_returns_cached_value_on_subsequent_call(mod):
    mod._sibling_cache.clear()
    sentinel = object()
    mod._load_sibling = lambda *_a, **_k: lambda *_args, **_kwargs: sentinel
    mod._gap_helper()  # populate cache

    def _explode(*_a, **_k):
        raise AssertionError('cache miss on second call')
    mod._load_sibling = _explode
    assert mod._gap_helper()() is sentinel


# --- gap helper exception fallback inside rollup --------------------------


class GapHelperError(Exception):
    """Raised by tests to exercise the rollup's gap-failure fallback."""


def test_rollup_continues_when_gap_helper_raises(mod):
    # When the citation-gap call fails for a keyword, the rollup should
    # still surface the outranked-keyword data without exclusive sources.
    def boom(*_a, **_k):
        raise GapHelperError('gap helper exploded')
    mod._sibling_cache['gap'] = boom
    rollup = mod._build_competitor_rollup(
        'Adidas', ['best running shoes'], CONFIG,
    )
    # Outranked is still computed from the rank fixture.
    assert rollup['outranked_keywords'][0]['keyword'] == 'best running shoes'
    # Exclusive sources is empty since the gap call failed.
    assert rollup['exclusive_sources'] == []


# --- _list_tracked_keywords -----------------------------------------------


def test_list_tracked_keywords_reads_from_keywords_table_when_configured(raw_mod):
    fake_table = MagicMock()
    fake_table.scan.return_value = {
        'Items': [
            {'keyword': 'shoes'},
            {'keyword': 'boots'},
            {'keyword': 'shoes'},  # duplicate to verify de-dup
        ],
    }
    fake_dynamodb = MagicMock()
    fake_dynamodb.Table.return_value = fake_table

    with patch.object(raw_mod, 'KEYWORDS_TABLE', 'test-keywords'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._list_tracked_keywords(50)

    assert result == ['shoes', 'boots']


def test_list_tracked_keywords_falls_back_to_search_results_when_no_keywords_table(raw_mod):
    fake_table = MagicMock()
    fake_table.scan.return_value = {
        'Items': [{'keyword': 'fallback-kw'}],
    }
    fake_dynamodb = MagicMock()
    fake_dynamodb.Table.return_value = fake_table

    with patch.object(raw_mod, 'KEYWORDS_TABLE', None):
        with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test-search'):
            with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
                result = raw_mod._list_tracked_keywords(50)

    assert result == ['fallback-kw']


def test_list_tracked_keywords_returns_empty_when_no_tables_configured(raw_mod):
    with patch.object(raw_mod, 'KEYWORDS_TABLE', None):
        with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', None):
            result = raw_mod._list_tracked_keywords(50)
    assert result == []


def test_list_tracked_keywords_caps_result_at_limit(raw_mod):
    fake_table = MagicMock()
    fake_table.scan.return_value = {
        'Items': [{'keyword': f'kw-{i}'} for i in range(20)],
    }
    fake_dynamodb = MagicMock()
    fake_dynamodb.Table.return_value = fake_table

    with patch.object(raw_mod, 'KEYWORDS_TABLE', 'test-keywords'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._list_tracked_keywords(5)

    assert len(result) == 5


# --- _latest_brand_ranks --------------------------------------------------


def _ranks_event(items):
    """Build a fake DynamoDB query response containing search-result items."""
    fake_table = MagicMock()
    fake_table.query.return_value = {'Items': items}
    fake_dynamodb = MagicMock()
    fake_dynamodb.Table.return_value = fake_table
    return fake_dynamodb


def test_latest_brand_ranks_returns_empty_when_search_table_unset(raw_mod):
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', None):
        result = raw_mod._latest_brand_ranks('shoes')
    assert result == {}


def test_latest_brand_ranks_returns_empty_when_query_returns_no_items(raw_mod):
    fake_dynamodb = _ranks_event([])
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')
    assert result == {}


def test_latest_brand_ranks_aggregates_across_providers(raw_mod):
    items = [
        {
            'timestamp': '2026-05-15T00:00:00Z',
            'provider': 'openai',
            'brands': [
                {
                    'name': 'Nike', 'rank': 2,
                    'classification': 'first_party',
                },
            ],
        },
        {
            'timestamp': '2026-05-15T00:00:00Z',
            'provider': 'perplexity',
            'brands': [
                {
                    'name': 'Nike', 'rank': 5,
                    'classification': 'first_party',
                },
            ],
        },
    ]
    fake_dynamodb = _ranks_event(items)
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')

    nike = result['nike']
    # Best rank (smallest) across providers wins.
    assert nike['best_rank'] == 2
    assert sorted(nike['providers']) == ['openai', 'perplexity']


def test_latest_brand_ranks_filters_to_latest_timestamp_only(raw_mod):
    items = [
        {
            'timestamp': '2026-05-14T00:00:00Z',  # older
            'provider': 'openai',
            'brands': [
                {'name': 'Nike', 'rank': 1, 'classification': 'first_party'},
            ],
        },
        {
            'timestamp': '2026-05-15T00:00:00Z',  # newest — only this counts
            'provider': 'openai',
            'brands': [
                {'name': 'Nike', 'rank': 7, 'classification': 'first_party'},
            ],
        },
    ]
    fake_dynamodb = _ranks_event(items)
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')
    # Should reflect rank=7 from the newest timestamp, not rank=1 from older.
    assert result['nike']['best_rank'] == 7


def test_latest_brand_ranks_handles_invalid_rank_values_as_999(raw_mod):
    items = [
        {
            'timestamp': '2026-05-15T00:00:00Z',
            'provider': 'openai',
            'brands': [
                {'name': 'Nike', 'rank': 'not-a-number',
                 'classification': 'first_party'},
            ],
        },
    ]
    fake_dynamodb = _ranks_event(items)
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')
    assert result['nike']['best_rank'] == 999


def test_latest_brand_ranks_skips_brands_with_empty_name(raw_mod):
    items = [
        {
            'timestamp': '2026-05-15T00:00:00Z',
            'provider': 'openai',
            'brands': [
                {'name': '', 'rank': 1},
                {'name': 'Nike', 'rank': 3, 'classification': 'first_party'},
            ],
        },
    ]
    fake_dynamodb = _ranks_event(items)
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')
    assert list(result.keys()) == ['nike']


def test_latest_brand_ranks_keeps_default_classification_when_missing(raw_mod):
    # Brands without an explicit `classification` field should keep the
    # default ('other') rather than overwrite it with a falsy value.
    items = [
        {
            'timestamp': '2026-05-15T00:00:00Z',
            'provider': 'openai',
            'brands': [
                {'name': 'Mystery', 'rank': 1},  # no classification
            ],
        },
    ]
    fake_dynamodb = _ranks_event(items)
    with patch.object(raw_mod, 'SEARCH_RESULTS_TABLE', 'test'):
        with patch.object(raw_mod, 'dynamodb', fake_dynamodb):
            result = raw_mod._latest_brand_ranks('shoes')
    assert result['mystery']['classification'] == 'other'
