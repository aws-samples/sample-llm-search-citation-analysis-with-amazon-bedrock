"""
Tests for get-reports-competitor.py — the /reports/competitor rollup.

Strategy mirrors test_get_reports_overview.py: load the module, then prime
the lazy sibling cache and the per-keyword rank lookup with stubs so we
never touch DynamoDB.
"""

import json
import os
from unittest.mock import patch

import pytest

from shared.scope_params import ReportScope
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))
# The tables the module resolves at import (both always set on the StatsInsights Lambda).
_ENV = {'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search', 'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}


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


@pytest.fixture
def mod(monkeypatch: pytest.MonkeyPatch):
    """get-reports-competitor.py with the per-keyword evidence and the keyword listing stubbed.

    Each keyword's evidence comes from the rank and gap fixtures; the keyword
    listing answers the rank fixture's keywords, for the test's lifetime.
    """
    with patch.dict(os.environ, _ENV):
        module = load_handler_module(_API_DIR, 'get-reports-competitor.py')

    monkeypatch.setattr(module, '_keyword_evidence', lambda keyword, config: module.KeywordEvidence(
        keyword, DEFAULT_RANKS.get(keyword, {}), DEFAULT_GAPS.get(keyword, {}).get('gaps', []),
    ))
    monkeypatch.setattr(module, '_list_tracked_keywords', lambda limit: (list(DEFAULT_RANKS)[:limit], len(DEFAULT_RANKS)))
    return module


@pytest.fixture
def raw_mod():
    """The module without the helper stubs — for testing the real
    DynamoDB-backed _list_tracked_keywords / _latest_brand_ranks."""
    with patch.dict(os.environ, _ENV):
        return load_handler_module(_API_DIR, 'get-reports-competitor.py', 'get_reports_competitor_unstubbed')


# Adidas outranks Nike on a keyword: the setup under which Adidas's rollup
# picks up that keyword's exclusive sources.
ADIDAS_OUTRANKS_NIKE = {
    'adidas': {
        'best_rank': 1, 'providers': ['openai'],
        'classification': 'competitor',
    },
    'nike': {
        'best_rank': 5, 'providers': ['openai'],
        'classification': 'first_party',
    },
}


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


@pytest.fixture
def running_shoes_rollup(mod):
    """Adidas's rollup over the one keyword where it outranks the first party."""
    return mod._build_competitor_rollup('Adidas', mod._collect_evidence(['best running shoes'], CONFIG), CONFIG)


@pytest.fixture
def two_keyword_rollup(mod):
    """Adidas's rollup over a keyword it outranks us on and one where we already win."""
    evidence = mod._collect_evidence(['best running shoes', 'best hiking boots'], CONFIG)
    return mod._build_competitor_rollup('Adidas', evidence, CONFIG)


def test_rollup_picks_keywords_where_competitor_outranks_first_party(two_keyword_rollup):
    keywords_outranked = [r['keyword'] for r in two_keyword_rollup['outranked_keywords']]
    assert 'best running shoes' in keywords_outranked


def test_rollup_excludes_keywords_where_first_party_already_wins(two_keyword_rollup):
    keywords_outranked = [r['keyword'] for r in two_keyword_rollup['outranked_keywords']]
    # Adidas is rank 8 on hiking boots, Nike is rank 6 — Adidas does NOT outrank
    assert 'best hiking boots' not in keywords_outranked


def test_rollup_records_their_best_rank_and_our_best_rank(running_shoes_rollup):
    row = running_shoes_rollup['outranked_keywords'][0]
    # Fixture: Adidas best=1, Nike best=2.
    assert row['their_best_rank'] == 1
    assert row['our_best_rank'] == 2


def test_rollup_records_rank_delta_as_their_minus_our(running_shoes_rollup):
    # delta = our(2) - their(1) = 1
    assert running_shoes_rollup['outranked_keywords'][0]['rank_delta'] == 1


def test_rollup_records_providers_for_outranked_row(running_shoes_rollup):
    assert running_shoes_rollup['outranked_keywords'][0]['providers'] == ['openai', 'perplexity']


def test_rollup_finds_exclusive_sources_for_named_competitor(two_keyword_rollup):
    urls = [s['url'] for s in two_keyword_rollup['outreach_targets']]
    assert 'https://example.com/shoes-review' in urls


def test_rollup_propagates_priority_and_lift_for_exclusive_source(running_shoes_rollup):
    source = running_shoes_rollup['outreach_targets'][0]
    assert source['priority'] == 'high'
    # provider_count=3, citation_count=9, lift = 3 * log(10) ~= 6.91
    assert source['lift_score'] == 6.91


def test_rollup_counts_the_exclusive_and_high_priority_sources(running_shoes_rollup):
    counts = (running_shoes_rollup['exclusive_source_count'], running_shoes_rollup['high_priority_source_count'])
    assert counts == (1, 1)


def test_rollup_skips_sources_naming_other_competitors(two_keyword_rollup):
    urls = [s['url'] for s in two_keyword_rollup['outreach_targets']]
    # Asics-only and Merrell-only sources should not be in Adidas's rollup
    assert 'https://other.com/asics' not in urls
    assert 'https://outside.com/merrell' not in urls


def _one_keyword_evidence(mod, gaps):
    """Evidence of keyword ``kw``: Adidas outranks Nike, with ``gaps``."""
    return [mod.KeywordEvidence('kw', ADIDAS_OUTRANKS_NIKE, gaps)]


def test_rollup_orders_outreach_targets_by_lift_score_descending(mod):
    # Build a fixture with 3 sources of different lift scores so ordering
    # is meaningfully tested (the default fixture only has 1 per keyword).
    gaps = [
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
    ]
    rollup = mod._build_competitor_rollup('Adidas', _one_keyword_evidence(mod, gaps), CONFIG)
    targets = rollup['outreach_targets']
    assert [target['url'] for target in targets] == ['https://high.com', 'https://mid.com', 'https://low.com']


_FIFTEEN_SOURCES = [
    {
        'url': f'https://s{i}.com', 'domain': f's{i}.com',
        'priority': 'high' if i % 3 == 0 else 'medium', 'citation_count': i + 1, 'provider_count': 2,
        'providers': ['openai', 'g'], 'competitor_brands': ['Adidas'],
    }
    for i in range(15)
]


def test_rollup_caps_outreach_targets_at_ten_when_more_exist(mod):
    rollup = mod._build_competitor_rollup('Adidas', _one_keyword_evidence(mod, _FIFTEEN_SOURCES), CONFIG)
    assert len(rollup['outreach_targets']) == 10


def test_rollup_counts_every_exclusive_source_beyond_the_listed_targets(mod):
    rollup = mod._build_competitor_rollup('Adidas', _one_keyword_evidence(mod, _FIFTEEN_SOURCES), CONFIG)
    assert (rollup['exclusive_source_count'], rollup['high_priority_source_count']) == (15, 5)


def test_rollup_no_longer_lists_every_exclusive_source(running_shoes_rollup):
    assert 'exclusive_sources' not in running_shoes_rollup


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


@pytest.mark.parametrize(('keyword_limit', 'truncated'), [(2, True), (3, False)])
def test_build_flags_active_keywords_beyond_the_keyword_limit(mod, keyword_limit, truncated):
    payload = mod.build_competitor_rollups(CONFIG, competitor='Adidas', keyword_limit=keyword_limit)
    assert payload['keywords_truncated'] is truncated


_MANY_COMPETITORS = {'tracked_brands': {'first_party': ['Nike'], 'competitors': [f'Rival {i:02d}' for i in range(14)]}}


def test_build_rolls_up_at_most_the_first_ten_configured_competitors(mod):
    payload = mod.build_competitor_rollups(_MANY_COMPETITORS, competitor=None, keyword_limit=10)
    assert [rollup['competitor'] for rollup in payload['rollups']] == [f'Rival {i:02d}' for i in range(10)]


def test_build_lists_every_configured_competitor_and_flags_the_cut(mod):
    payload = mod.build_competitor_rollups(_MANY_COMPETITORS, competitor=None, keyword_limit=10)
    assert (len(payload['competitors']), payload['competitors_truncated']) == (14, True)


def test_build_reads_each_keyword_once_for_every_competitor(mod, monkeypatch):
    reads = []
    monkeypatch.setattr(mod, '_keyword_evidence', lambda keyword, config: reads.append(keyword) or mod.KeywordEvidence(keyword))

    mod.build_competitor_rollups(CONFIG, competitor=None, keyword_limit=10)

    assert sorted(reads) == sorted(DEFAULT_RANKS)


# --- handler -------------------------------------------------------------


def _get_competitor_report(mod, **params):
    """The handler's response to ``params`` with the brand configuration of ``CONFIG``."""
    with patch.object(mod, 'get_brand_config', return_value=CONFIG):
        return mod.handler(_event(**params), None)


@pytest.fixture
def adidas_response(mod):
    return _get_competitor_report(mod, competitor='Adidas')


def test_handler_returns_200_for_valid_competitor(adidas_response):
    assert adidas_response['statusCode'] == 200


def test_handler_returns_single_rollup_payload_for_named_competitor(adidas_response):
    body = json.loads(adidas_response['body'])
    assert body['competitor'] == 'Adidas'
    assert body['rollup']['competitor'] == 'Adidas'


def test_handler_includes_outranked_keywords_in_payload(adidas_response):
    body = json.loads(adidas_response['body'])
    keywords_outranked = [
        r['keyword'] for r in body['rollup']['outranked_keywords']
    ]
    assert 'best running shoes' in keywords_outranked


@pytest.mark.parametrize('params', [
    pytest.param({'competitor': 'Unknown'}, id='unconfigured-competitor'),
    pytest.param({'keyword_limit': 999}, id='keyword-limit-above-max'),
    pytest.param({'keyword_limit': 0}, id='keyword-limit-below-min'),
])
def test_handler_returns_400_for_an_invalid_request(mod, params):
    assert _get_competitor_report(mod, **params)['statusCode'] == 400


def test_handler_returns_all_rollups_payload_when_competitor_omitted(mod):
    body = json.loads(_get_competitor_report(mod)['body'])
    assert 'rollups' in body
    assert len(body['rollups']) == 4


def test_handler_returns_iso_generated_at_with_zulu(adidas_response):
    body = json.loads(adidas_response['body'])
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
        (lambda *_a, **_k: sentinel) if attr == 'latest_run_gaps'
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


def _search_item(brands, timestamp='2026-05-15T00:00:00Z', provider='openai', citations=()):
    """One SearchResults row as `_latest_run_rows` reads it."""
    return {'timestamp': timestamp, 'provider': provider, 'brands': brands, 'citations': list(citations)}


def _search_table_dynamodb(items):
    """A resource whose tables answer every query with `items`."""
    return fake_dynamodb_resource(fake_table(query={'Items': items}))


def test_rollup_continues_when_gap_helper_raises(raw_mod):
    # When the citation-gap call fails for a keyword, the rollup should
    # still surface the outranked-keyword data without exclusive sources.
    def boom(*_a, **_k):
        raise GapHelperError('gap helper exploded')
    raw_mod._sibling_cache['gap'] = boom
    items = [_search_item([
        {'name': 'Adidas', 'rank': 1, 'classification': 'competitor'},
        {'name': 'Nike', 'rank': 2, 'classification': 'first_party'},
    ])]
    with patch.object(raw_mod, 'dynamodb', _search_table_dynamodb(items)):
        evidence = [raw_mod._keyword_evidence('best running shoes', CONFIG)]
    rollup = raw_mod._build_competitor_rollup('Adidas', evidence, CONFIG)
    # Outranked is still computed from the ranks of the rows.
    assert rollup['outranked_keywords'][0]['keyword'] == 'best running shoes'
    # No exclusive source since the gap call failed.
    assert rollup['exclusive_source_count'] == 0


def test_keyword_evidence_hands_the_latest_run_rows_to_the_gap_helper(raw_mod):
    received = []
    raw_mod._sibling_cache['gap'] = lambda rows, config: received.append(rows) or []
    items = [
        _search_item([], timestamp='2026-05-14T00:00:00Z', citations=['https://old.example']),
        _search_item([], citations=['https://new.example']),
    ]
    with patch.object(raw_mod, 'dynamodb', _search_table_dynamodb(items)):
        raw_mod._keyword_evidence('shoes', CONFIG)
    assert received == [[items[1]]]


def test_latest_run_rows_reads_one_projected_page_newest_first(raw_mod):
    table = fake_table(query={'Items': []})
    with patch.object(raw_mod, 'dynamodb', fake_dynamodb_resource(table)):
        raw_mod._latest_run_rows('shoes')
    kwargs = table.query.call_args.kwargs
    assert (kwargs['ProjectionExpression'], kwargs['Limit'], kwargs['ScanIndexForward']) == (
        '#ts, provider, citations, brands', 50, False,
    )


# --- _list_tracked_keywords -----------------------------------------------


def _keywords_table_listing(raw_mod, keywords, limit):
    """``_list_tracked_keywords(limit)`` when the active keywords are ``keywords``."""
    scope = ReportScope('all', tuple(keywords), {'mode': 'all'}, 'All keywords')
    with patch.object(raw_mod, 'all_active_scope', return_value=scope):
        return raw_mod._list_tracked_keywords(limit)


def test_list_tracked_keywords_reads_the_active_keywords_in_order(raw_mod):
    assert _keywords_table_listing(raw_mod, ['boots', 'shoes'], 50) == (['boots', 'shoes'], 2)


def test_list_tracked_keywords_caps_result_at_limit_and_counts_every_active_keyword(raw_mod):
    assert _keywords_table_listing(raw_mod, [f'kw-{i:02d}' for i in range(20)], 5) == ([f'kw-{i:02d}' for i in range(5)], 20)


# --- _brand_ranks ---------------------------------------------------------


def _latest_ranks(raw_mod, items):
    """The brand ranks of the latest run of 'shoes' when the search table answers `items`."""
    with patch.object(raw_mod, 'dynamodb', _search_table_dynamodb(items)):
        return raw_mod._brand_ranks(raw_mod._latest_run_rows('shoes'))


def test_latest_brand_ranks_returns_empty_when_query_returns_no_items(raw_mod):
    assert _latest_ranks(raw_mod, []) == {}


def test_latest_brand_ranks_aggregates_across_providers(raw_mod):
    items = [
        _search_item([{'name': 'Nike', 'rank': 2, 'classification': 'first_party'}], provider='openai'),
        _search_item([{'name': 'Nike', 'rank': 5, 'classification': 'first_party'}], provider='perplexity'),
    ]

    result = _latest_ranks(raw_mod, items)

    nike = result['nike']
    # Best rank (smallest) across providers wins.
    assert nike['best_rank'] == 2
    assert sorted(nike['providers']) == ['openai', 'perplexity']


def test_latest_brand_ranks_filters_to_latest_timestamp_only(raw_mod):
    items = [
        # older
        _search_item([{'name': 'Nike', 'rank': 1, 'classification': 'first_party'}], timestamp='2026-05-14T00:00:00Z'),
        # newest — only this counts
        _search_item([{'name': 'Nike', 'rank': 7, 'classification': 'first_party'}], timestamp='2026-05-15T00:00:00Z'),
    ]

    result = _latest_ranks(raw_mod, items)

    # Should reflect rank=7 from the newest timestamp, not rank=1 from older.
    assert result['nike']['best_rank'] == 7


def test_latest_brand_ranks_handles_invalid_rank_values_as_999(raw_mod):
    items = [_search_item([{'name': 'Nike', 'rank': 'not-a-number', 'classification': 'first_party'}])]

    result = _latest_ranks(raw_mod, items)

    assert result['nike']['best_rank'] == 999


def test_latest_brand_ranks_skips_brands_with_empty_name(raw_mod):
    items = [_search_item([
        {'name': '', 'rank': 1},
        {'name': 'Nike', 'rank': 3, 'classification': 'first_party'},
    ])]

    result = _latest_ranks(raw_mod, items)

    assert list(result.keys()) == ['nike']


def test_latest_brand_ranks_keeps_default_classification_when_missing(raw_mod):
    # Brands without an explicit `classification` field should keep the
    # default ('other') rather than overwrite it with a falsy value.
    items = [_search_item([{'name': 'Mystery', 'rank': 1}])]

    result = _latest_ranks(raw_mod, items)

    assert result['mystery']['classification'] == 'other'
