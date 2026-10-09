"""
The 2.37.0 provider refresh and markets in the search handler.

- the answer engines' current response shapes are read (fixtures are trimmed
  live answers, ``testing.provider_response_fixtures``): Perplexity's Agent
  API, OpenAI's Responses API with ``web_search``, Claude's
  ``web_search_20260318`` with dynamic filtering (searches run from code, no
  text citations) and with direct callers (text blocks cite their sources)
- the workflow event's ``market`` reaches every provider, every stored row,
  the raw-answer document and the brand extraction

The keyword itself is the measured prompt and stays identical across
providers and markets; a market only adds each provider's instructions /
location hint (AI engines) or locale parameters (search providers).
"""

from __future__ import annotations

import copy
import json
import os
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.handler_fixtures import handler_fixture
from testing.provider_response_fixtures import (
    CHILE_MARKET_JSON,
    CLAUDE_DIRECT_RESPONSE,
    CLAUDE_DYNAMIC_FILTERING_RESPONSE,
    OPENAI_WEB_SEARCH_RESPONSE,
    PERPLEXITY_AGENT_RESPONSE,
    PERPLEXITY_AGENT_TEXT,
    build_market,
    claude_search_error_response,
)
from testing.search_handler_fixtures import SEARCH_HANDLER_ENV

# handler.py is loaded under its own module name (several Lambdas own a
# `handler.py`; see test_handler_prompts.py).
search_handler = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'handler.py', 'search_handler_markets', env=SEARCH_HANDLER_ENV,
)

_KEYWORD = 'is altiplano a good airline'
_TIMESTAMP = '2026-10-08T10:00:00Z'
_RAW_KEY = 'raw-responses/2026-10-08/is-altiplano-a-good-airline/openai/{prompt}/2026-10-08T10-00-00Z.json'
_EVENT: dict[str, Any] = {
    'keyword': _KEYWORD,
    'timestamp': _TIMESTAMP,
    'query_prompts': [{'id': 'p1', 'name': 'Family', 'template': None}],
    'providers': ['openai'],
}
_CHILE_EVENT: dict[str, Any] = {**_EVENT, 'market': CHILE_MARKET_JSON}
_ABC = 'https://abceconomia.co/2026/09/24/altiplano-mejor-aerolinea-de-sudamerica-skytrax-2026/'
_BLOOMBERG = 'https://www.bloomberglinea.com/estilo-de-vida/las-mejores-aerolineas-de-america-latina-en-2026/'


def _llm_result(provider: str = 'openai', prompt_id: str = 'p1') -> dict[str, Any]:
    """A successful answer-engine result with a raw answer to store."""
    return {
        'provider': provider, 'provider_type': 'llm', 'response': 'Altiplano y Sky Airline...', 'status': 'success',
        'citations': ['https://www.altiplano-air.example/cl'], 'raw_response': {'output': []},
        'metadata': {'model': 'gpt-5-mini', 'latency_ms': 900, 'cost_usd': 0.0054},
        'query_prompt_id': prompt_id, 'query_prompt_name': 'Family',
    }


# --- Response shapes -----------------------------------------------------------


class TestPerplexityAgentApiAnswer:
    def test_reads_the_text_of_the_message_item(self, search_handler):
        assert search_handler._parse_perplexity_response(PERPLEXITY_AGENT_RESPONSE)[0] == PERPLEXITY_AGENT_TEXT

    def test_cites_the_search_results_that_have_a_url(self, search_handler):
        assert search_handler._parse_perplexity_response(PERPLEXITY_AGENT_RESPONSE)[1] == [_ABC, _BLOOMBERG]

    def test_adds_the_urls_of_message_annotations_once(self, search_handler):
        answer = copy.deepcopy(PERPLEXITY_AGENT_RESPONSE)
        answer['output'][1]['content'][0]['annotations'] = [
            {'type': 'url_citation', 'url': _BLOOMBERG},
            {'type': 'url_citation', 'url': 'https://www.altiplano-air.example/cl/es?utm_source=pplx'},
        ]

        assert search_handler._parse_perplexity_response(answer)[1] == [_ABC, _BLOOMBERG, 'https://www.altiplano-air.example/cl/es']

    def test_falls_back_to_the_urls_in_the_text_without_search_results(self, search_handler):
        answer = {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'Ver https://www.altiplano-air.example/cl.'}]}]}

        assert search_handler._parse_perplexity_response(answer)[1] == ['https://www.altiplano-air.example/cl']

    @pytest.mark.parametrize(('answer', 'field', 'expected'), [
        (PERPLEXITY_AGENT_RESPONSE, 'cost_usd', 0.00538),
        ({'output': [], 'usage': {'cost': {'total_cost': 'free'}}}, 'cost_usd', None),
        ({'output': [], 'usage': {'input_tokens': 3}}, 'cost_usd', None),
        (PERPLEXITY_AGENT_RESPONSE, 'model', 'perplexity/sonar'),
    ], ids=['reported-cost', 'cost-not-a-number', 'no-cost', 'model-that-answered'])
    def test_records_what_perplexity_reports_in_the_metadata(self, search_handler, answer, field, expected):
        client = MagicMock()
        client.agent_response.return_value = answer
        with patch.object(search_handler, 'PerplexityClient', return_value=client):
            result = search_handler.query_perplexity(_KEYWORD, 'pk-test')

        assert result['metadata'].get(field) == expected


class TestSlowEngineAttempts:
    def test_asks_openai_with_the_bounded_attempt_budget(self, search_handler):
        client = MagicMock()
        client.responses_with_web_search.return_value = OPENAI_WEB_SEARCH_RESPONSE
        with patch.object(search_handler, 'OpenAIClient', return_value=client):
            search_handler.query_openai(_KEYWORD, 'sk-test')

        assert client.responses_with_web_search.call_args.kwargs['max_retries'] == search_handler.SLOW_ENGINE_MAX_ATTEMPTS

    def test_asks_claude_with_the_bounded_attempt_budget(self, search_handler):
        client = MagicMock()
        client.generate_content.return_value = {'content': [], 'model': 'claude-sonnet-5-5'}
        with patch.object(search_handler, 'ClaudeClient', return_value=client):
            search_handler.query_claude(_KEYWORD, 'ck-test')

        assert client.generate_content.call_args.kwargs['max_retries'] == search_handler.SLOW_ENGINE_MAX_ATTEMPTS


class TestOpenAIWebSearchAnswer:
    def test_reads_the_message_text(self, search_handler):
        text, _citations = search_handler._parse_openai_response(OPENAI_WEB_SEARCH_RESPONSE)

        assert text.startswith('Buen — te doy una comparación práctica')

    def test_cites_the_searched_sources_then_the_annotations_cleaned_and_once(self, search_handler):
        assert search_handler._parse_openai_response(OPENAI_WEB_SEARCH_RESPONSE)[1] == [
            'https://www.airlineratings.com/airlines/altiplano/safety',
            'https://skytraxratings.com/airlines/altiplano-airlines-rating',
            'https://comparadorvuelos.jac.gob.cl/Home/Fichas',
        ]


class TestClaudeWebSearchAnswer:
    def test_cites_the_results_of_searches_run_from_code(self, search_handler):
        assert search_handler._parse_claude_response(CLAUDE_DYNAMIC_FILTERING_RESPONSE)[1] == [
            'https://chile.ladevi.info/transporte/companias-aereas/aerolineas-sky-airline-lidero-el-ranking-puntualidad-latinoamerica-junio-n102959',
            'https://www.tripadvisor.com/ShowTopic-g294291-i1357-k13686355-Sky_Airline_and_Jetsmart-Chile.html',
        ]

    def test_reads_only_the_text_blocks_as_the_answer(self, search_handler):
        assert search_handler._parse_claude_response(CLAUDE_DYNAMIC_FILTERING_RESPONSE)[0] == (
            '**Resumen:** Altiplano es una buena opción para volar desde Chile.'
        )

    def test_cites_the_sources_text_blocks_name_after_the_search_results(self, search_handler):
        assert search_handler._parse_claude_response(CLAUDE_DIRECT_RESPONSE)[1] == [
            _BLOOMBERG, 'https://www.aviacionnews.com/2026/09/altiplano-vuelve-a-ser-la-mejor-aerolinea-de-sudamerica/',
        ]

    def test_joins_the_text_blocks_of_a_cited_answer(self, search_handler):
        assert search_handler._parse_claude_response(CLAUDE_DIRECT_RESPONSE)[0] == (
            '# ¿Es Altiplano una buena aerolínea?\n\nTambién fue la aerolínea más limpia de Sudamérica.'
        )

    def test_keeps_the_answer_of_a_failed_search_without_its_citations(self, search_handler):
        """The error object in place of the result list used to be iterated and crash the parse."""
        text, citations = search_handler._parse_claude_response(claude_search_error_response('max_uses_exceeded'))

        assert (text.endswith('más limpia de Sudamérica.'), citations) == (True, [])


# --- The event's market ----------------------------------------------------------


@pytest.fixture
def fan_out(search_handler) -> Iterator[MagicMock]:
    """The provider fan-out (returning no results) and storage stubbed; yields both mocks."""
    with (
        patch.object(search_handler, 'execute_all_providers', return_value=[]) as execute,
        patch.object(search_handler, 'store_search_results', return_value=True) as store,
    ):
        yield MagicMock(execute=execute, store=store)


class TestEventMarket:
    def test_runs_the_providers_for_the_events_market(self, search_handler, fan_out):
        search_handler.handler(dict(_CHILE_EVENT), None)

        assert fan_out.execute.call_args.kwargs['market'] == build_market()

    @pytest.mark.parametrize('event', [_EVENT, {**_EVENT, 'market': None}], ids=['absent', 'null'])
    def test_runs_the_providers_for_the_global_market_without_one(self, search_handler, fan_out, event):
        search_handler.handler(dict(event), None)

        assert fan_out.execute.call_args.kwargs['market'] is None

    def test_stores_the_results_under_the_events_market(self, search_handler, fan_out):
        search_handler.handler(dict(_CHILE_EVENT), None)

        assert fan_out.store.call_args.args[3] == build_market()

    @pytest.mark.parametrize('market', [
        {**CHILE_MARKET_JSON, 'country': 'Chile'}, {'market_id': 'cl-es'}, 'cl-es', {**CHILE_MARKET_JSON, 'market_id': 'global'},
    ], ids=['bad-country', 'incomplete', 'not-an-object', 'reserved-id'])
    def test_refuses_a_market_that_fails_validation_rather_than_asking_globally(self, search_handler, fan_out, market):
        with pytest.raises(ValueError, match=r'^Invalid market in event$'):
            search_handler.handler({**_EVENT, 'market': market}, None)

        assert fan_out.execute.call_count == 0


@pytest.fixture
def every_provider_runs(search_handler) -> Iterator[None]:
    """Every secret configured and every provider enabled; outcome bookkeeping stubbed."""
    with (
        patch.object(search_handler, 'get_api_key', return_value='key'),
        patch.object(search_handler, 'is_provider_enabled', return_value=True),
        patch.object(search_handler, '_record_provider_outcome'),
        patch.object(search_handler, 'get_provider_model', side_effect=lambda provider_id: f'{provider_id}-model'),
    ):
        yield


@pytest.fixture
def engines(search_handler) -> Iterator[MagicMock]:
    """The four answer-engine client classes, patched; yields them as attributes named by provider."""
    with (
        patch.object(search_handler, 'OpenAIClient') as openai,
        patch.object(search_handler, 'PerplexityClient') as perplexity,
        patch.object(search_handler, 'GeminiClient') as gemini,
        patch.object(search_handler, 'ClaudeClient') as claude,
    ):
        yield MagicMock(openai=openai, perplexity=perplexity, gemini=gemini, claude=claude)


@pytest.mark.usefixtures('every_provider_runs')
class TestMarketReachesEveryProvider:
    @pytest.mark.parametrize(('provider_id', 'method'), [
        ('openai', 'responses_with_web_search'),
        ('perplexity', 'agent_response'),
        ('gemini', 'generate_content'),
        ('claude', 'generate_content'),
    ])
    def test_hands_the_market_to_the_answer_engine_client(self, search_handler, engines, provider_id, method):
        search_handler.execute_all_providers(_KEYWORD, providers=[provider_id], market=build_market())

        call = getattr(getattr(engines, provider_id).return_value, method).call_args
        assert call.kwargs['market'] == build_market()

    @pytest.mark.parametrize('client_name', [
        'BraveSearchClient', 'TavilySearchClient', 'ExaSearchClient', 'SerpAPIClient', 'FirecrawlSearchClient',
    ])
    def test_hands_the_market_to_the_search_provider(self, search_handler, client_name):
        client_class = getattr(search_handler, client_name)
        with patch.object(client_class, 'search', return_value={'provider': client_class.provider_id}) as search:
            search_handler.execute_all_providers(_KEYWORD, providers=[client_class.provider_id], market=build_market())

        assert search.call_args.args == (_KEYWORD, build_market())

    def test_asks_every_answer_engine_the_same_question_from_a_market(self, search_handler, engines):
        search_handler.execute_all_providers(
            _KEYWORD, providers=['openai', 'perplexity', 'gemini', 'claude'],
            query_template='Viajo con niños. {keyword}', market=build_market(),
        )

        assert {
            engines.openai.return_value.responses_with_web_search.call_args.kwargs['query'],
            engines.perplexity.return_value.agent_response.call_args.args[0],
            engines.gemini.return_value.generate_content.call_args.args[0],
            engines.claude.return_value.generate_content.call_args.args[0],
        } == {f'Viajo con niños. {_KEYWORD}'}

    def test_gives_claude_the_citation_instruction_with_the_market(self, search_handler, engines):
        search_handler.execute_all_providers(_KEYWORD, providers=['claude'], market=build_market())

        system_prompt = engines.claude.return_value.generate_content.call_args.kwargs['system_prompt']
        assert system_prompt == search_handler.CLAUDE_CITATION_SYSTEM_PROMPT


# --- Storage ----------------------------------------------------------------------


@pytest.fixture
def storage(search_handler) -> Iterator[MagicMock]:
    """DynamoDB, S3, the brand config and Bedrock extraction stubbed; yields the mocks and a ``store`` shortcut."""
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    stored_config = {'industry': 'airlines', 'tracked_brands': {'first_party': ['Altiplano'], 'competitors': ['Avianca']}}
    with (
        patch.object(search_handler, 'dynamodb', resource),
        patch.object(search_handler, 's3_client') as s3_client,
        patch.object(search_handler, 'get_brand_config', return_value=stored_config) as get_brand_config,
        patch.object(search_handler, 'extract_brands_from_response', return_value={'brands': [], 'brand_count': 0}) as extract,
    ):
        def store(*results: dict[str, Any], market: Any = None) -> None:
            search_handler.store_search_results(_KEYWORD, _TIMESTAMP, list(results or [_llm_result()]), market)

        yield MagicMock(
            table=table, s3=s3_client, extract=extract, get_brand_config=get_brand_config,
            stored_config=stored_config, store=store,
        )


def _stored_rows(storage: MagicMock) -> list[dict[str, Any]]:
    return [call.kwargs['Item'] for call in storage.table.put_item.call_args_list]


class TestStoredRows:
    def test_records_the_market_on_every_row(self, storage):
        storage.store(_llm_result('openai'), _llm_result('claude'), market=build_market())

        assert [row['market_id'] for row in _stored_rows(storage)] == ['cl-es', 'cl-es']

    def test_records_the_global_market_without_one(self, storage):
        storage.store()

        assert _stored_rows(storage)[0]['market_id'] == 'global'

    def test_keeps_the_sort_key(self, storage):
        storage.store(market=build_market())

        assert _stored_rows(storage)[0]['timestamp_provider'] == f'{_TIMESTAMP}#openai#p1'

    def test_stores_the_reported_cost_as_a_decimal(self, storage):
        storage.store()

        assert str(_stored_rows(storage)[0]['metadata']['cost_usd']) == '0.0054'

    def test_points_the_row_at_the_stored_document(self, storage):
        storage.store()

        assert _stored_rows(storage)[0]['raw_response_s3_uri'] == f"s3://test-raw-responses/{_RAW_KEY.format(prompt='p1')}"


class TestBrandExtractionPerMarket:
    def test_tracks_the_markets_competitors_and_local_brand_names(self, storage):
        storage.store(market=build_market())

        assert storage.extract.call_args.kwargs['config']['tracked_brands'] == {
            'first_party': ['Altiplano', 'Altiplano Air Chile'],
            'competitors': ['Avianca', 'Sky Airline', 'JetSMART'],
        }

    def test_uses_the_stored_config_as_is_without_a_market(self, storage):
        storage.store()

        assert storage.extract.call_args.kwargs['config'] == storage.stored_config

    def test_reads_the_brand_config_once_for_all_results(self, storage):
        storage.store(_llm_result('perplexity'), _llm_result('gemini'), _llm_result('claude'), market=build_market())

        assert storage.get_brand_config.call_count == 1

    def test_adds_the_market_names_to_the_extractor_defaults_when_nothing_is_stored(self, storage):
        storage.get_brand_config.return_value = {}

        storage.store(market=build_market())

        config = storage.extract.call_args.kwargs['config']
        assert (config['industry'], config['tracked_brands']['competitors']) == ('general', ['Sky Airline', 'JetSMART'])

    def test_extracts_nothing_when_extraction_is_switched_off(self, search_handler, storage):
        with patch.object(search_handler, 'get_extraction_config', return_value={'brand_extraction': {'enabled': False}}):
            storage.store(market=build_market())

        assert (storage.extract.call_count, _stored_rows(storage)[0]['brand_count']) == (0, 0)


class TestRawResponseKey:
    def test_files_each_answer_under_its_date_keyword_provider_and_query_prompt(self, search_handler):
        assert search_handler.raw_response_s3_key('Is Altiplano a good airline?', 'openai', 'p1', _TIMESTAMP) == (
            _RAW_KEY.format(prompt='p1')
        )

    @pytest.mark.parametrize(('prompt_id', 'segment'), [('Family / Kids', 'family-kids'), ('///', 'default')])
    def test_slugs_the_query_prompt_id(self, search_handler, prompt_id, segment):
        assert search_handler.raw_response_s3_key(_KEYWORD, 'openai', prompt_id, _TIMESTAMP).split('/')[4] == segment

    def test_stores_each_persona_of_a_keyword_under_its_own_key(self, storage):
        """Personas share the run timestamp; one key per provider used to keep only the last persona."""
        storage.store(_llm_result(prompt_id='p1'), _llm_result(prompt_id='p2'))

        assert [call.kwargs['Key'] for call in storage.s3.put_object.call_args_list] == [
            _RAW_KEY.format(prompt='p1'), _RAW_KEY.format(prompt='p2'),
        ]

    def test_records_the_query_prompt_and_market_in_the_stored_document(self, storage):
        storage.store(market=build_market())

        document = json.loads(storage.s3.put_object.call_args.kwargs['Body'])
        assert (document['query_prompt_id'], document['market_id']) == ('p1', 'cl-es')
