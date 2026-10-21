"""
Volume tests for GET /api/citation-gaps over a large keyword group.

Before: a group or ``keyword_ids`` scope lifted the keyword cap
(``limit = max(limit, len(keywords))``), so a 500-keyword group read 500
SearchResults partitions six at a time (~85 rounds, past API Gateway's 29 s)
and returned ~150 bytes of summary per keyword (~75 KB, the response itself
was never the problem). Now a group reads at most ``SCOPE_KEYWORDS_CAP``
partitions and says so with ``keywords_truncated``.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.scope_params import SCOPE_KEYWORDS_CAP, ReportScope
from testing.citation_gaps_fixtures import load_citation_gaps
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event
from testing.response_size import assert_within_page_budget, long_text

_mod = load_citation_gaps('get_citation_gaps_volume_under_test')

CONFIG: dict[str, Any] = {
    'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': ['Cóndor Vuelos']},
    'first_party_domains': ['altiplano.example'],
}

_KEYWORDS = tuple(f'vuelos económicos destino {index:03d}' for index in range(500))


def _run_rows() -> list[dict[str, Any]]:
    """One latest run: 8 engines, each citing 20 competitor-only pages with long accented URLs."""
    return [
        {
            'timestamp': '2026-10-01T08:00:00Z',
            'provider': f'engine-{engine}',
            'citations': [f'https://guía-{source}.example/{long_text(120)}' for source in range(20)],
            'brands': [{'name': 'Cóndor Vuelos', 'classification': 'competitor'}],
        }
        for engine in range(8)
    ]


def _group(keywords: tuple[str, ...]) -> ReportScope:
    return ReportScope('group', keywords, {'mode': 'group', 'group_id': 'g-sur'}, 'Sur')


@pytest.fixture
def search_table(monkeypatch) -> Any:
    table = fake_table(query={'Items': _run_rows()})
    monkeypatch.setattr(_mod, 'dynamodb', fake_dynamodb_resource(by_name={
        _mod.SEARCH_RESULTS_TABLE: table,
        _mod.CRAWLED_CONTENT_TABLE: fake_table(query={'Items': [{'title': long_text(300)}]}),
    }))
    return table


class TestLargeGroup:
    def test_stays_within_page_budget_when_a_group_has_500_keywords(self, search_table):
        payload = _mod.gaps_for_scope(_group(_KEYWORDS), CONFIG, 10)
        response = _mod.success_response(payload, api_gateway_event('GET', '/api/citation-gaps'))

        assert_within_page_budget(response)

    def test_reads_at_most_the_scope_cap_of_keyword_partitions(self, search_table):
        _mod.gaps_for_scope(_group(_KEYWORDS), CONFIG, 10)

        assert search_table.query.call_count == SCOPE_KEYWORDS_CAP

    def test_flags_the_keywords_left_out_of_a_large_group(self, search_table):
        result = _mod.gaps_for_scope(_group(_KEYWORDS), CONFIG, 10)

        assert (result['keywords_truncated'], result['keywords_analyzed']) == (True, SCOPE_KEYWORDS_CAP)

    def test_analyses_every_keyword_of_a_group_above_limit_but_within_the_cap(self, search_table):
        result = _mod.gaps_for_scope(_group(_KEYWORDS[:30]), CONFIG, 10)

        assert (result['keywords_truncated'], result['keywords_analyzed']) == (False, 30)

    def test_flags_active_keywords_beyond_limit_without_a_scope(self, search_table, monkeypatch):
        monkeypatch.setattr(_mod, 'all_active_scope', lambda _table: ReportScope('all', _KEYWORDS[:12], {'mode': 'all'}, 'All'))

        result = _mod.gaps_for_scope(None, CONFIG, 10)

        assert (result['keywords_truncated'], result['keywords_analyzed']) == (True, 10)


class TestLatestRunGaps:
    def test_lists_every_competitor_only_source_of_the_rows(self):
        gaps = _mod.latest_run_gaps(_run_rows(), CONFIG)

        assert (len(gaps), gaps[0]['provider_count'], gaps[0]['priority']) == (20, 8, 'high')

    def test_leaves_out_sources_that_also_cite_a_first_party_brand(self):
        rows = [{'provider': 'openai', 'citations': ['https://both.example/a'], 'brands': [
            {'name': 'Cóndor Vuelos', 'classification': 'competitor'},
            {'name': 'Altiplano Air', 'classification': 'first_party'},
        ]}]

        assert _mod.latest_run_gaps(rows, CONFIG) == []
