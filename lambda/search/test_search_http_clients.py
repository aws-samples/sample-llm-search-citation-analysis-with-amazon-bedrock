"""
Tests for the HTTP search providers in ``search_clients`` (Brave, Tavily, Exa,
Firecrawl): the request each one sends and the standard search-provider result
it maps the answer to. SerpAPI is covered in ``test_search_clients.py``.
"""

from __future__ import annotations

import logging
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest

import search_clients

_HIT = {'url': 'https://hotel.es/riazor?utm_source=x', 'title': 'Hotel Riazor'}
_NO_URL = {'title': 'No url, dropped'}


class _Case(NamedTuple):
    """One provider: its client, the HTTP verb and request it sends, the answer and what the answer adds."""

    client_class: type
    provider_id: str
    log_label: str
    method: str
    url: str
    request_kwargs: dict[str, Any]
    answer: dict[str, Any]
    extra_fields: dict[str, Any]
    extra_metadata: dict[str, Any]


_CASES = [
    pytest.param(_Case(
        search_clients.BraveSearchClient, 'brave', 'Brave Search', 'get', 'https://api.search.brave.com/res/v1/web/search',
        {'headers': {'Accept': 'application/json', 'X-Subscription-Token': 'key-1'},
         'params': {'q': 'hotel coruña', 'count': 10, 'text_decorations': False, 'search_lang': 'en'}, 'timeout': 30},
        {'web': {'results': [{**_HIT, 'description': 'Frente a la playa'}, _NO_URL]}},
        {},
        {},
    ), id='brave'),
    pytest.param(_Case(
        search_clients.TavilySearchClient, 'tavily', 'Tavily Search', 'post', 'https://api.tavily.com/search',
        {'headers': {'Content-Type': 'application/json'},
         'json': {'api_key': 'key-1', 'query': 'hotel coruña', 'search_depth': 'basic', 'include_answer': True,
                  'include_raw_content': False, 'max_results': 10}, 'timeout': 30},
        {'results': [{**_HIT, 'content': 'Frente a la playa', 'score': 0.9}, _NO_URL], 'answer': 'Hotel Riazor', 'response_time': 1.5},
        {'score': 0.9},
        {'answer': 'Hotel Riazor', 'response_time': 1.5},
    ), id='tavily'),
    pytest.param(_Case(
        search_clients.ExaSearchClient, 'exa', 'Exa Search', 'post', 'https://api.exa.ai/search',
        {'headers': {'Content-Type': 'application/json', 'x-api-key': 'key-1'},
         'json': {'query': 'hotel coruña', 'type': 'auto', 'numResults': 10,
                  'contents': {'text': {'maxCharacters': 500}, 'highlights': True}}, 'timeout': 30},
        {'results': [{**_HIT, 'text': 'Frente a la playa', 'publishedDate': '2026-01-02', 'author': 'Ana', 'highlights': ['playa']}],
         'searchType': 'neural', 'requestId': 'req-1'},
        {'published_date': '2026-01-02', 'author': 'Ana', 'highlights': ['playa']},
        {'search_type': 'neural', 'request_id': 'req-1'},
    ), id='exa'),
    pytest.param(_Case(
        search_clients.FirecrawlSearchClient, 'firecrawl', 'Firecrawl Search', 'post', 'https://api.firecrawl.dev/v1/search',
        {'headers': {'Authorization': 'Bearer key-1', 'Content-Type': 'application/json'},
         'json': {'query': 'hotel coruña', 'limit': 10}, 'timeout': 60},
        {'data': {'web': [{**_HIT, 'description': 'Frente a la playa', 'category': 'travel'}]}, 'id': 'job-1', 'creditsUsed': 2},
        {'category': 'travel'},
        {'job_id': 'job-1', 'credits_used': 2},
    ), id='firecrawl'),
]


def _search(client_class: type, method: str, answer: dict) -> tuple[dict, MagicMock]:
    """Run ``client_class('key-1').search('hotel coruña')`` with ``requests.<method>`` answering ``answer``."""
    response = MagicMock(status_code=200)
    response.json.return_value = answer
    with patch.object(search_clients.requests, method, return_value=response) as send:
        return client_class('key-1').search('hotel coruña'), send


def _failed_search(case: _Case) -> dict:
    """Run ``case``'s client against a ``requests.<method>`` that raises ``ValueError('bad gateway answer')``."""
    with patch.object(search_clients.requests, case.method, side_effect=ValueError('bad gateway answer')):
        return case.client_class('key-1').search('hotel coruña')


@pytest.fixture
def searched(case: _Case) -> tuple[dict, MagicMock]:
    """The result and the patched ``requests`` call of one search against ``case``'s provider."""
    return _search(case.client_class, case.method, case.answer)


@pytest.mark.parametrize('case', _CASES)
class TestSearchHttpClients:
    def test_sends_the_providers_search_request(self, case: _Case, searched: tuple[dict, MagicMock]):
        _result, send = searched

        send.assert_called_once_with(case.url, **case.request_kwargs)

    def test_maps_hits_with_a_url_to_cleaned_search_results(self, case: _Case, searched: tuple[dict, MagicMock]):
        result, _send = searched

        assert result['search_results'] == [{
            'url': 'https://hotel.es/riazor', 'title': 'Hotel Riazor', 'snippet': 'Frente a la playa',
            **case.extra_fields, 'source': case.provider_id,
        }]

    def test_returns_a_success_with_the_raw_answer_and_cleaned_citations(self, case: _Case, searched: tuple[dict, MagicMock]):
        result, _send = searched

        assert (result['status'], result['provider'], result['provider_type'], result['response'], result['citations'], result['raw_response']) == (
            'success', case.provider_id, 'search', '', ['https://hotel.es/riazor'], case.answer,
        )

    def test_records_the_result_count_and_provider_details_in_metadata(self, case: _Case, searched: tuple[dict, MagicMock]):
        result, _send = searched

        metadata = dict(result['metadata'])
        latency_ms = metadata.pop('latency_ms')
        assert (isinstance(latency_ms, int), metadata) == (True, {'result_count': 1, **case.extra_metadata})

    def test_a_failed_request_becomes_an_error_result_with_its_message(self, case: _Case):
        result = _failed_search(case)

        assert (result['status'], result['error'], result['citations'], result['search_results'], result['raw_response'], sorted(result['metadata'])) == (
            'error', 'bad gateway answer', [], [], None, ['latency_ms'],
        )

    def test_a_failed_request_logs_an_error_line_naming_the_provider(self, case: _Case, caplog: pytest.LogCaptureFixture):
        _failed_search(case)

        assert [(r.levelno, r.getMessage()) for r in caplog.records if r.name == 'search_clients'] == [
            (logging.ERROR, f'{case.log_label} error'),
        ]


class TestTavilyResultShapes:
    def test_gives_a_hit_with_only_a_url_an_empty_title_and_snippet_and_a_zero_score(self):
        result, _send = _search(search_clients.TavilySearchClient, 'post', {'results': [{'url': 'https://hotel.es/a'}]})

        assert result['search_results'] == [
            {'url': 'https://hotel.es/a', 'title': '', 'snippet': '', 'score': 0, 'source': 'tavily'},
        ]

    def test_records_an_empty_answer_and_no_response_time_when_the_answer_omits_them(self):
        result, _send = _search(search_clients.TavilySearchClient, 'post', {'results': []})

        assert (result['metadata']['answer'], result['metadata']['response_time']) == ('', None)


@pytest.mark.parametrize('client_class', [search_clients.BaseSearchClient, search_clients._HttpSearchClient])
def test_a_client_without_its_provider_request_cannot_be_created(client_class: type):
    with pytest.raises(TypeError, match='abstract method'):
        client_class('key-1')


class TestExaResultShapes:
    def test_gives_each_hit_without_highlights_its_own_empty_list(self):
        answer = {'results': [{'url': 'https://hotel.es/a'}, {'url': 'https://hotel.es/b'}]}

        result, _send = _search(search_clients.ExaSearchClient, 'post', answer)

        first, second = (hit['highlights'] for hit in result['search_results'])
        assert (first, second, first is second) == ([], [], False)


class TestFirecrawlResultShapes:
    def test_reads_a_bare_data_list(self):
        answer = {'data': [{**_HIT, 'description': 'Frente a la playa'}]}

        result, _send = _search(search_clients.FirecrawlSearchClient, 'post', answer)

        assert result['citations'] == ['https://hotel.es/riazor']

    def test_treats_data_of_another_type_as_no_hits(self):
        result, _send = _search(search_clients.FirecrawlSearchClient, 'post', {'data': 'unexpected'})

        assert (result['status'], result['citations']) == ('success', [])
