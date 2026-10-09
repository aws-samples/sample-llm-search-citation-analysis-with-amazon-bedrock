"""
Tests for the SerpAPI search provider (``search_clients.SerpAPIClient``).

The client hands the search to ``shared.serpapi.serpapi_search`` (async
submit + Search Archive, tested in ``shared/test_serpapi.py``) and maps the
finished search to the standard search-provider result.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

import search_clients
from shared import serpapi
from shared.provider_health import INSUFFICIENT_CREDIT, classify_provider_error
from shared.serpapi import SerpApiError

_FINISHED_SEARCH = {
    'search_metadata': {'id': 'search-1', 'status': 'Success'},
    'organic_results': [
        {'position': 1, 'link': 'https://hotel.es/riazor?utm_source=serp', 'title': 'Hotel Riazor',
         'snippet': 'Frente a la playa', 'displayed_link': 'hotel.es/riazor'},
        {'position': 2, 'title': 'No link, dropped'},
    ],
    'knowledge_graph': {'title': 'Hotel Riazor'},
}


def _search_with(**serpapi_stub) -> tuple[dict, MagicMock]:
    """Run ``search_clients.SerpAPIClient('serp-key').search('hotel coruña')`` with ``serpapi_search`` stubbed as given."""
    with patch.object(search_clients, 'serpapi_search', **serpapi_stub) as stub:
        return search_clients.SerpAPIClient('serp-key').search('hotel coruña'), stub


class TestSerpAPIClient:
    def test_maps_organic_results_with_a_link_to_search_results(self):
        result, _stub = _search_with(return_value=_FINISHED_SEARCH)

        assert result['search_results'] == [{
            'url': 'https://hotel.es/riazor', 'title': 'Hotel Riazor', 'snippet': 'Frente a la playa',
            'position': 1, 'displayed_link': 'hotel.es/riazor', 'source': 'serpapi',
        }]

    def test_returns_a_success_with_the_cleaned_citations(self):
        result, _stub = _search_with(return_value=_FINISHED_SEARCH)

        assert (result['status'], result['provider'], result['citations']) == (
            'success', 'serpapi', ['https://hotel.es/riazor'],
        )

    def test_records_the_search_id_and_knowledge_graph_in_metadata(self):
        result, _stub = _search_with(return_value=_FINISHED_SEARCH)

        assert (result['metadata']['search_id'], result['metadata']['has_knowledge_graph'], result['metadata']['result_count']) == (
            'search-1', True, 1,
        )

    def test_searches_google_us_english_for_ten_results_with_the_key(self):
        _result, stub = _search_with(return_value=_FINISHED_SEARCH)

        stub.assert_called_once_with('serp-key', {'q': 'hotel coruña', 'engine': 'google', 'num': 10, 'hl': 'en', 'gl': 'us'})

    def test_a_serpapi_error_becomes_an_error_result_with_its_message(self):
        result, _stub = _search_with(side_effect=SerpApiError('SerpAPI search search-1 timed out: still pending after 300s'))

        assert (result['status'], result['error'], result['citations']) == (
            'error', 'SerpAPI search search-1 timed out: still pending after 300s', [],
        )

    def test_a_serpapi_error_logs_a_serpapi_error_line(self, caplog: pytest.LogCaptureFixture):
        _search_with(side_effect=SerpApiError('quota'))

        assert [(r.levelno, r.getMessage()) for r in caplog.records if r.name == 'search_clients'] == [
            (logging.ERROR, 'SerpAPI error'),
        ]

    def test_quota_exhaustion_error_text_classifies_as_insufficient_credit(self):
        spent = MagicMock(status_code=429, text='{"error": "Your account has run out of searches."}', headers={})

        with patch.object(serpapi.requests, 'get', return_value=spent):
            result = search_clients.SerpAPIClient('serp-key').search('hotel coruña')

        assert classify_provider_error(result['error']) == INSUFFICIENT_CREDIT
