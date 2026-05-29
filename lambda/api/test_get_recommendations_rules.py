"""
Tests for get-recommendations.py's generate_rule_based_recommendations.

Pins two behaviors changed in the Action Center "Option A" work:

1. Cap removal — the rule engine analyzes EVERY active keyword the Keywords
   scan returns, not just the first 20. Previously `keywords[:20]` silently
   excluded keywords beyond the 20th, hiding gaps from the Action Center.

2. Competitor-dominance comparison — a keyword is flagged as competitor
   dominance only when competitors are present AND the first-party brand is
   absent or ranked outside the top 3 (TOP_RANK_THRESHOLD). The previous
   check compared a rank against a mention count
   (`fp_best_rank > comp_mentions`), which mixed unrelated units and could
   flag a keyword where the brand ranked #2 with a single competitor mention.

DynamoDB is patched at the module boundary; no AWS calls are made.
"""

import importlib
import importlib.util
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Mount shared layer / fall back to lambda/ source tree.
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


def _load_get_recommendations():
    """Load get-recommendations.py with boto3 patched out at module level."""
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = MagicMock()
    mock_bedrock = MagicMock()

    spec = importlib.util.spec_from_file_location(
        'get_recommendations_rules_under_test',
        os.path.join(_API_DIR, 'get-recommendations.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['get_recommendations_rules_under_test'] = mod

    with patch.dict(os.environ, {
        'DYNAMODB_TABLE_SEARCH_RESULTS': 't',
        'DYNAMODB_TABLE_CITATIONS': 't',
        'DYNAMODB_TABLE_CRAWLED_CONTENT': 't',
    }):
        with patch('boto3.resource', return_value=mock_dynamodb):
            with patch('boto3.client', return_value=mock_bedrock):
                spec.loader.exec_module(mod)

    return mod


@pytest.fixture
def mod():
    return _load_get_recommendations()


_CONFIG = {'tracked_brands': {'first_party': ['Mine'], 'competitors': ['Competitor']}}


def _item(keyword: str, brands: list[dict[str, Any]], provider: str = 'openai') -> dict[str, Any]:
    return {
        'keyword': keyword,
        'timestamp': '2026-01-01T00:00:00Z',
        'provider': provider,
        'brands': brands,
    }


def _competitor_only() -> list[dict[str, Any]]:
    return [{'name': 'Competitor', 'classification': 'competitor'}]


def _setup_dynamo(mod, keywords: list[str], query_responses: list[dict[str, Any]]) -> MagicMock:
    """Wire the module's dynamodb resource to a fake table.

    The same table object backs both the Keywords scan and the per-keyword
    SearchResults queries (the handler calls dynamodb.Table for each). scan()
    returns the keyword list; query() yields one canned response per call in
    keyword order.
    """
    table = MagicMock()
    table.scan.return_value = {'Items': [{'keyword': k} for k in keywords]}
    table.query.side_effect = list(query_responses)
    fake_dynamo = MagicMock()
    fake_dynamo.Table.return_value = table
    mod.dynamodb = fake_dynamo
    return table


class TestKeywordCapRemoval:
    def test_analyzes_all_active_keywords_beyond_the_legacy_20_cap(self, mod) -> None:
        keywords = [f'kw{i}' for i in range(22)]
        responses = [{'Items': [_item(k, _competitor_only())]} for k in keywords]
        table = _setup_dynamo(mod, keywords, responses)

        with patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'kw-table'}):
            recs = mod.generate_rule_based_recommendations(_CONFIG)

        # One SearchResults query per keyword — proves the [:20] slice is gone.
        assert table.query.call_count == 22
        gap = next(r for r in recs if r['type'] == 'visibility_gap')
        assert gap['title'] == 'Missing from 22 Keywords'


class TestCompetitorDominanceComparison:
    def test_does_not_flag_competitor_dominance_when_first_party_ranks_in_top_3(self, mod) -> None:
        # Brand ranks #2 (top 3) with one competitor mention. The old
        # rank-vs-count check (2 > 1) wrongly flagged this; the rank-threshold
        # check (2 > 3) does not.
        brands = [
            {'name': 'Mine', 'classification': 'first_party', 'rank': 2},
            {'name': 'Competitor', 'classification': 'competitor'},
        ]
        _setup_dynamo(mod, ['kw0'], [{'Items': [_item('kw0', brands)]}])

        with patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'kw-table'}):
            recs = mod.generate_rule_based_recommendations(_CONFIG)

        assert all(r['type'] != 'competitive' for r in recs)

    def test_flags_competitor_dominance_when_first_party_ranks_below_top_3(self, mod) -> None:
        brands = [
            {'name': 'Mine', 'classification': 'first_party', 'rank': 5},
            {'name': 'Competitor', 'classification': 'competitor'},
        ]
        _setup_dynamo(mod, ['kw0'], [{'Items': [_item('kw0', brands)]}])

        with patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'kw-table'}):
            recs = mod.generate_rule_based_recommendations(_CONFIG)

        assert any(r['type'] == 'competitive' for r in recs)

    def test_flags_competitor_dominance_when_first_party_is_absent(self, mod) -> None:
        _setup_dynamo(mod, ['kw0'], [{'Items': [_item('kw0', _competitor_only())]}])

        with patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'kw-table'}):
            recs = mod.generate_rule_based_recommendations(_CONFIG)

        assert any(r['type'] == 'competitive' for r in recs)
