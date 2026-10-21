"""
Volume tests for GET /api/reports/competitor.

Before: without ``competitor=`` the route rolled up every configured
competitor, each with every exclusive source unsliced. For 100 keywords whose
latest run cites 50 competitor-only pages naming 10 competitors, that is
100 x 50 x ~350 B ≈ 1.75 MB per competitor, ~17.5 MB for 10 (a 502 past the
6 MiB cap; more with accented URLs). The read repeated per competitor: one
unprojected partition page, one gap query and up to 70 crawl lookups per
keyword, sequentially.

Now each keyword is read once (one projected page), rollups hold counts and
the ten best outreach targets, and at most ``MAX_ROLLUP_COMPETITORS`` rollups
are built.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.scope_params import ReportScope
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event
from testing.module_loader import load_handler_module
from testing.response_size import assert_within_page_budget, long_text

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
}

_COMPETITORS = [f'Aerolínea Rival {index:02d}' for index in range(12)]
_CONFIG = {
    'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': _COMPETITORS},
    'first_party_domains': ['altiplano.example'],
}
_KEYWORDS = tuple(f'vuelos económicos destino {index:03d}' for index in range(100))


def _run_rows() -> list[dict[str, Any]]:
    """One latest run: 8 engines citing 50 accented pages that name every competitor and never us."""
    brands = [{'name': name, 'rank': rank + 1, 'classification': 'competitor'} for rank, name in enumerate(_COMPETITORS)]
    citations = [f'https://reseñas-{source}.example/{long_text(150)}' for source in range(50)]
    return [
        {'timestamp': '2026-10-01T08:00:00Z', 'provider': f'engine-{engine}', 'citations': citations, 'brands': brands}
        for engine in range(8)
    ]


@pytest.fixture
def search_table() -> MagicMock:
    return fake_table(query={'Items': _run_rows()})


@pytest.fixture
def mod(search_table: MagicMock, monkeypatch: pytest.MonkeyPatch):
    with patch.dict(os.environ, _ENV):
        module = load_handler_module(_API_DIR, 'get-reports-competitor.py', 'get_reports_competitor_volume_under_test')
    monkeypatch.setattr(module, 'dynamodb', fake_dynamodb_resource(search_table))
    monkeypatch.setattr(module, 'all_active_scope', lambda _table: ReportScope('all', _KEYWORDS, {'mode': 'all'}, 'All keywords'))
    return module


def _get(module: Any, query: dict[str, str]) -> dict[str, Any]:
    with patch.object(module, 'get_brand_config', return_value=_CONFIG), patch.dict(os.environ, _ENV):
        return module.handler(api_gateway_event('GET', '/api/reports/competitor', query=query), None)


class TestEveryCompetitor:
    def test_stays_within_page_budget_when_every_competitor_is_rolled_up(self, mod):
        response = _get(mod, {'keyword_limit': '100'})

        assert_within_page_budget(response)

    def test_reads_each_keyword_once_whatever_the_number_of_competitors(self, mod, search_table):
        _get(mod, {'keyword_limit': '100'})

        assert search_table.query.call_count == len(_KEYWORDS)


class TestOneCompetitor:
    def test_stays_within_page_budget_when_one_competitor_has_5000_exclusive_sources(self, mod):
        response = _get(mod, {'keyword_limit': '100', 'competitor': _COMPETITORS[0]})

        assert_within_page_budget(response)

    def test_counts_every_exclusive_source_while_listing_ten(self, mod):
        body = json.loads(_get(mod, {'keyword_limit': '100', 'competitor': _COMPETITORS[0]})['body'])

        rollup = body['rollup']
        assert (rollup['exclusive_source_count'], len(rollup['outreach_targets'])) == (5_000, 10)
