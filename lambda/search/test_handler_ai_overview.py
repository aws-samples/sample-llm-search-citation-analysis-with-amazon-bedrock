"""Google AI Overviews as an answer engine: its client's provider result (``google_ai_overview``), and how the
search handler asks it and stores its SearchResults rows.

DataForSEO is never called: ``ai_overview_search`` is replaced on the client module.
"""

from __future__ import annotations

import os
from dataclasses import replace
from unittest.mock import MagicMock, patch

import google_ai_overview
import pytest
from google_ai_overview import AiOverviewResult

from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_locations import GLOBAL_MARKET_CODES
from shared.dataforseo_serp import OrganicItem
from shared.markets import Market
from shared.provider_health import INVALID_KEY, classify_provider_error
from testing.handler_fixtures import handler_fixture
from testing.search_handler_fixtures import SEARCH_HANDLER_ENV

search_handler = handler_fixture(
    module_name='search_handler_ai_overview', directory=os.path.dirname(os.path.abspath(__file__)),
    filename='handler.py', env=SEARCH_HANDLER_ENV,
)

_KEYWORD = 'hotel coruña'
_ORGANIC = (
    OrganicItem(position=1, rank_absolute=2, url='https://example.com/riazor', domain='example.com',
                title='Riazor rooms', description='Sea view rooms'),
    OrganicItem(position=2, rank_absolute=4, url='https://example.org/guide', domain='example.org',
                title='Coruña guide', description='Where to stay'),
)
_METADATA = {'model': 'google-serp', 'latency_ms': 900, 'cost_usd': 0.004, 'attempts': 1}
_RAW_RESULT = {'keyword': _KEYWORD, 'items': [{'type': 'ai_overview', 'items': [], 'references': []}]}
_ANSWERED = AiOverviewResult(
    status='success', answer_markdown='Stay at Example Air Hotel.[[1]](https://example.com/riazor)',
    answer_text='Stay at Example Air Hotel.', citations=('https://example.com/riazor',),
    organic=_ORGANIC, metadata=dict(_METADATA), raw_result=_RAW_RESULT,
)
_NO_OVERVIEW = AiOverviewResult(
    status='no_answer', answer_markdown=None, answer_text='', citations=(), organic=_ORGANIC,
    metadata=dict(_METADATA),
)
_UNSERVED_MARKET = Market(
    market_id='cn', name='China', country='CN', country_name='China', language='zh-CN',
    language_name='Chinese', currency='CNY', timezone='Asia/Shanghai',
)
_PERSONA_EVENT = {
    'keyword': _KEYWORD,
    'timestamp': '2026-10-02T10:00:00Z',
    'query_prompts': [
        {'id': 'p1', 'name': 'Family', 'template': 'As a family, {keyword}'},
        {'id': 'p2', 'name': 'Business', 'template': 'For a business trip, {keyword}'},
    ],
    'providers': ['google_ai_overview'],
}


@pytest.fixture
def overview(search_handler):
    """The DataForSEO login set, the engine enabled, health and storage stubbed; yields the AIO mock.

    A run with a ``timestamp`` is resumable, so the answers an earlier attempt stored are read first: none here.
    """
    with (
        patch.object(search_handler, 'get_api_key', return_value='login@example.com:secret'),
        patch.object(search_handler, 'is_provider_enabled', return_value=True),
        patch.object(search_handler, 'wait_for_send_slot'),
        patch.object(search_handler, '_record_provider_outcome'),
        patch.object(search_handler, 'stored_slim_results', return_value={}),
        patch.object(search_handler, 'store_search_results', return_value=True) as store,
        patch.object(google_ai_overview, 'ai_overview_search', return_value=_ANSWERED) as search,
    ):
        yield MagicMock(search=search, store=store)


class TestRunner:
    def test_returns_no_answer_row_with_empty_response_when_page_has_no_overview(self, search_handler, overview):
        overview.search.return_value = _NO_OVERVIEW

        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert (result['status'], result['response'], result['citations']) == ('no_answer', '', [])

    def test_keeps_organic_top_ten_on_no_answer_row(self, search_handler, overview):
        overview.search.return_value = _NO_OVERVIEW

        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert [hit['url'] for hit in result['search_results']] == ['https://example.com/riazor', 'https://example.org/guide']

    def test_returns_overview_text_and_cited_urls_when_overview_shown(self, search_handler, overview):
        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert (result['status'], result['response'], result['citations']) == (
            'success', 'Stay at Example Air Hotel.', ['https://example.com/riazor'],
        )

    def test_stores_organic_hits_in_search_results_shape_when_overview_shown(self, search_handler, overview):
        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert result['search_results'][0] == {
            'url': 'https://example.com/riazor', 'title': 'Riazor rooms', 'snippet': 'Sea view rooms',
            'position': 1, 'domain': 'example.com', 'rank_absolute': 2, 'source': 'google_ai_overview',
        }

    def test_keeps_dataforseos_result_as_returned_for_the_raw_object_and_the_markdown_beside_it(self, search_handler, overview):
        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert (result['raw_response'], result['answer_markdown']) == (
            {'dataforseo_result': _RAW_RESULT}, 'Stay at Example Air Hotel.[[1]](https://example.com/riazor)',
        )

    def test_labels_row_as_llm_answer_engine(self, search_handler, overview):
        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert (result['provider'], result['provider_type']) == ('google_ai_overview', 'llm')

    def test_asks_global_market_as_united_states_english_when_no_market(self, search_handler, overview):
        google_ai_overview.query_google_ai_overview(_KEYWORD)

        overview.search.assert_called_once_with(_KEYWORD, GLOBAL_MARKET_CODES)

    def test_makes_no_call_when_market_is_unsupported(self, search_handler, overview):
        google_ai_overview.query_google_ai_overview(_KEYWORD, _UNSERVED_MARKET)

        overview.search.assert_not_called()

    def test_returns_unsupported_market_error_row_when_market_is_unsupported(self, search_handler, overview):
        result = google_ai_overview.query_google_ai_overview(_KEYWORD, _UNSERVED_MARKET)

        assert (result['status'], result['error_category']) == ('error', 'unsupported_market')

    def test_keeps_dataforseo_error_code_when_call_fails(self, search_handler, overview):
        overview.search.side_effect = DataForSeoError('AUTH_FAILED', 'DataForSEO HTTP 401', provider_status=401)

        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert (result['status'], result['error_code']) == ('error', 'AUTH_FAILED')

    def test_keeps_billed_cost_when_failed_call_was_charged(self, search_handler, overview):
        overview.search.side_effect = DataForSeoError('INTERNAL_ERROR', 'Invalid Field', cost_usd=0.004)

        result = google_ai_overview.query_google_ai_overview(_KEYWORD)

        assert result['metadata']['cost_usd'] == 0.004


class TestOncePerKeyword:
    def test_asks_plain_keyword_once_when_run_has_two_personas(self, search_handler, overview):
        search_handler.handler(dict(_PERSONA_EVENT), None)

        assert [call.args[0] for call in overview.search.call_args_list] == [_KEYWORD]

    def test_tags_single_row_with_default_prompt_when_run_has_personas(self, search_handler, overview):
        response = search_handler.handler(dict(_PERSONA_EVENT), None)

        assert [result['query_prompt_id'] for result in response['results']] == ['default']

    def test_runs_other_engines_once_per_persona_when_mixed_with_overviews(self, search_handler, overview):
        event = {**_PERSONA_EVENT, 'providers': ['google_ai_overview', 'brave']}
        brave_row = {'provider': 'brave', 'provider_type': 'search', 'response': '', 'status': 'success', 'citations': []}
        with patch.object(search_handler.BraveSearchClient, 'search', side_effect=lambda *_args: dict(brave_row)):
            response = search_handler.handler(event, None)

        assert [(row['provider'], row['query_prompt_id']) for row in response['results']] == [
            ('brave', 'p1'), ('brave', 'p2'), ('google_ai_overview', 'default'),
        ]

    def test_records_the_plain_keyword_as_the_query_sent_when_run_has_personas(self, search_handler, overview):
        search_handler.handler(dict(_PERSONA_EVENT), None)

        stored = overview.store.call_args.args[2]
        assert [result['query'] for result in stored] == [_KEYWORD]

    def test_asks_any_provider_defined_to_ask_the_plain_keyword_once_under_the_default_prompt(self, search_handler, overview):
        event = {**_PERSONA_EVENT, 'providers': ['brave']}
        brave_row = {'provider': 'brave', 'provider_type': 'search', 'response': '', 'status': 'success', 'citations': []}
        with (
            patch.object(search_handler, 'asks_plain_keyword', side_effect=lambda provider: provider == 'brave'),
            patch.object(search_handler.BraveSearchClient, 'search', side_effect=lambda *_args: dict(brave_row)) as search,
        ):
            response = search_handler.handler(event, None)

        assert (search.call_count, [row['query_prompt_id'] for row in response['results']]) == (1, ['default'])

    def test_asks_overviews_once_per_persona_when_its_definition_says_so(self, search_handler, overview):
        with patch.object(search_handler, 'asks_plain_keyword', return_value=False):
            search_handler.handler(dict(_PERSONA_EVENT), None)

        assert overview.search.call_count == 2

    def test_reads_dataforseo_login_secret_when_overviews_selected(self, search_handler, overview):
        search_handler.execute_all_providers(_KEYWORD, providers=['google_ai_overview'])

        search_handler.get_api_key.assert_called_once_with('dataforseo-key')

    def test_pays_no_second_overview_when_a_retried_attempt_finds_it_stored(self, search_handler, overview):
        stored = {('google_ai_overview', 'default'): {'provider': 'google_ai_overview', 'query_prompt_id': 'default'}}
        with patch.object(search_handler, 'stored_slim_results', return_value=stored):
            response = search_handler.handler(dict(_PERSONA_EVENT), None)

        assert (response['results'], overview.search.call_count) == (list(stored.values()), 0)


class TestRunnerQuery:
    def test_records_the_query_it_sent_on_an_answered_row(self, search_handler, overview):
        assert google_ai_overview.query_google_ai_overview(_KEYWORD)['query'] == _KEYWORD

    def test_records_the_query_it_would_have_sent_on_an_unsupported_market_row(self, search_handler, overview):
        assert google_ai_overview.query_google_ai_overview(_KEYWORD, _UNSERVED_MARKET)['query'] == _KEYWORD


class TestBrandsAndStorage:
    def test_skips_brand_extraction_when_row_is_no_answer(self, search_handler):
        row = {'provider': 'google_ai_overview', 'provider_type': 'llm', 'status': 'no_answer',
               'response': 'Example Air'}
        with patch.object(search_handler, 'extract_brands_from_response') as extract:
            brands = search_handler._extracted_brands(row, {'first_party_brands': ['Example Air']})

        assert (brands, extract.call_count) == ({'brands': [], 'brand_count': 0}, 0)

    def test_extracts_brands_when_overview_answered(self, search_handler):
        row = {'provider': 'google_ai_overview', 'provider_type': 'llm', 'status': 'success',
               'response': 'Example Air'}
        found = {'brands': [{'name': 'Example Air'}], 'brand_count': 1}
        with patch.object(search_handler, 'extract_brands_from_response', return_value=found):
            brands = search_handler._extracted_brands(row, {'first_party_brands': ['Example Air']})

        assert brands == found

    def test_writes_organic_results_on_stored_row_when_page_has_no_overview(self, search_handler):
        result = {**google_ai_overview.aio_result(_NO_OVERVIEW, _KEYWORD), 'query_prompt_id': 'default'}

        item = search_handler._result_item(_KEYWORD, '2026-10-02T10:00:00Z', result, {}, 'global', None)

        assert (item['status'], [hit['position'] for hit in item['search_results']]) == ('no_answer', [1, 2])


class TestHealth:
    @pytest.fixture
    def health(self, search_handler):
        with (
            patch.object(search_handler, 'record_provider_failure', return_value={'category': INVALID_KEY}) as failure,
            patch.object(search_handler, 'record_provider_success') as success,
            patch.object(search_handler.dynamodb, 'Table'),
        ):
            yield MagicMock(failure=failure, success=success)

    def test_classifies_auth_failure_as_invalid_key_when_dataforseo_rejects_login(self, search_handler, health):
        result = {'status': 'error', 'error': 'DataForSEO HTTP 401 on /v3', 'error_code': 'AUTH_FAILED'}

        search_handler._record_provider_outcome('google_ai_overview', result)

        assert classify_provider_error(health.failure.call_args.args[2]) == INVALID_KEY

    def test_records_no_failure_when_market_is_unsupported(self, search_handler, health):
        result = {'status': 'error', 'error': 'not served', 'error_category': 'unsupported_market'}

        search_handler._record_provider_outcome('google_ai_overview', result)

        assert (health.failure.call_count, result['error_category']) == (0, 'unsupported_market')

    def test_records_success_when_page_has_no_overview(self, search_handler, health):
        search_handler._record_provider_outcome('google_ai_overview', {'status': 'no_answer'})

        assert health.success.call_count == 1


def test_lists_overviews_after_claude_in_runner_registry(search_handler):
    ids = [provider_id for provider_id, *_rest in search_handler.PROVIDER_RUNNERS]

    assert ids[ids.index('claude') + 1] == 'google_ai_overview'


def test_trims_organic_results_to_ten_when_page_has_more(search_handler):
    many = tuple(replace(_ORGANIC[0], position=index) for index in range(1, 13))

    result = google_ai_overview.aio_result(replace(_NO_OVERVIEW, organic=many), _KEYWORD)

    assert [hit['position'] for hit in result['search_results']] == list(range(1, 11))
