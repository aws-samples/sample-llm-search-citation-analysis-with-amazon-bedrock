"""Real provider answers (trimmed) and a market, for the AI engine clients' and parsers' tests.

Every response below is a cut-down copy of a live answer recorded for 2.37.0
in ``.kiro/market-lab/raw/`` (the question: "Is Altiplano Air a good airline
to fly with? Compare it with the main alternatives.", asked from Santiago,
Chile in Spanish): the same keys, item types and nesting, with long texts,
signatures and encrypted payloads shortened and most list entries dropped.
"""

from __future__ import annotations

import copy
from typing import Any

from shared.markets import Market, validate_market
from testing.markets_fixtures import CHILE

_CHILE_EXTRAS: dict[str, Any] = {
    'region': 'Región Metropolitana',
    'competitors': ['Sky Airline', 'JetSMART'],
    'first_party_aliases': ['Altiplano Air Chile'],
}


def build_market(**overrides: Any) -> Market:
    """The Chilean market (with a region and local brand names) and ``overrides``, validated like a stored one."""
    market, error = validate_market({**CHILE, **_CHILE_EXTRAS, **overrides})
    if market is None:
        raise ValueError(error)
    return market


CHILE_MARKET_JSON: dict[str, Any] = build_market().to_json()
"""``Market.to_json()`` of the Chilean market, as a workflow event carries it."""


CHILE_INSTRUCTIONS = (
    'The user is located in Santiago, Chile (America/Santiago).\n'
    'Respond in Spanish (es-CL). Express prices in CLP.\n'
    'Prefer sources and options relevant to users in Chile.'
)
"""``market_instructions(build_market())``, spelled out."""

CHILE_USER_LOCATION = {
    'type': 'approximate', 'country': 'CL', 'city': 'Santiago',
    'region': 'Región Metropolitana', 'timezone': 'America/Santiago',
}
"""The OpenAI / Claude ``user_location`` of the Chilean market."""


# --- Perplexity Agent API (raw/perplexity_agent.json) ------------------------

PERPLEXITY_AGENT_RESPONSE: dict[str, Any] = {
    'id': 'resp_372a8cf9-83cd-44e2-9e45-b30aba0c6493',
    'object': 'response',
    'model': 'perplexity/sonar',
    'status': 'completed',
    'output': [
        {
            'type': 'search_results',
            'queries': [
                'Altiplano Air 2026 airline rating Skytrax punctuality',
                'best airlines South America 2026 Altiplano Skytrax',
            ],
            'results': [
                {
                    'id': 1, 'date': '2026-09-24', 'last_updated': '2026-09-25', 'source': 'web',
                    'title': 'Altiplano es la Mejor Aerolínea de Sudamérica en 2026 - ABC Economía',
                    'url': 'https://abceconomia.co/2026/09/24/altiplano-mejor-aerolinea-de-sudamerica-skytrax-2026/',
                    'snippet': 'Altiplano Air fue ratificada como la Mejor Aerolínea de Sudamérica...',
                },
                {
                    'id': 2, 'date': '2026-09-24', 'last_updated': '2026-10-03', 'source': 'web',
                    'title': 'Las mejores aerolíneas de América Latina en 2026',
                    'url': 'https://www.bloomberglinea.com/estilo-de-vida/las-mejores-aerolineas-de-america-latina-en-2026/',
                    'snippet': 'Las mejores aerolíneas de América Latina...',
                },
                {'id': 3, 'source': 'web', 'title': 'Sin URL', 'snippet': 'Un resultado sin enlace.'},
            ],
        },
        {
            'id': 'msg_2654e75f-8e06-4cca-84f7-ea8f8a9ebd85',
            'type': 'message',
            'role': 'assistant',
            'status': 'completed',
            'content': [{
                'type': 'output_text',
                'annotations': [],
                'text': 'Sí: **Altiplano suele ser una buena opción desde Santiago**, sobre todo si valoras la cantidad de rutas.',
            }],
        },
    ],
    'usage': {
        'input_tokens': 5157,
        'output_tokens': 637,
        'total_tokens': 5794,
        'cost': {
            'currency': 'USD', 'input_cost': 0.00015, 'output_cost': 0.00159,
            'tool_calls_cost': 0.0025, 'cache_creation_cost': 0.00114, 'total_cost': 0.00538,
        },
    },
}

PERPLEXITY_AGENT_TEXT = 'Sí: **Altiplano suele ser una buena opción desde Santiago**, sobre todo si valoras la cantidad de rutas.'

PERPLEXITY_MODELS_LISTING: dict[str, Any] = {
    'object': 'list',
    'data': [
        {'id': 'anthropic/claude-sonnet-5-5', 'object': 'model', 'created': 0, 'owned_by': 'anthropic'},
        {'id': 'google/gemini-3.6-flash', 'object': 'model', 'created': 0, 'owned_by': 'google'},
        {'id': 'openai/gpt-6-luna', 'object': 'model', 'created': 0, 'owned_by': 'openai'},
        {'id': 'perplexity/kimi-k3', 'object': 'model', 'created': 0, 'owned_by': 'perplexity'},
        {'id': 'perplexity/sonar', 'object': 'model', 'created': 0, 'owned_by': 'perplexity'},
        {'id': 'xai/grok-4.7', 'object': 'model', 'created': 0, 'owned_by': 'xai'},
    ],
}
"""``GET /v1/models`` (recorded 2026-10-08, six of its 53 entries)."""


# --- OpenAI Responses API with web_search (raw/openai_web_search.json) -------

OPENAI_WEB_SEARCH_RESPONSE: dict[str, Any] = {
    'id': 'resp_0e2e320984083e0a006ac7cd17539487d2a313d04b35fa4641',
    'object': 'response',
    'status': 'completed',
    'model': 'gpt-5-mini-2025-08-07',
    'tool_choice': 'required',
    'output': [
        {'id': 'rs_0e2e', 'type': 'reasoning', 'content': [], 'encrypted_content': 'gAAAAABqx8039cX'},
        {
            'id': 'ws_0e2e', 'type': 'web_search_call', 'status': 'completed',
            'action': {
                'type': 'search',
                'query': 'Altiplano Air review 2026 Skytrax Altiplano rating 2026',
                'queries': ['Altiplano Air review 2026 Skytrax Altiplano rating 2026', 'AirlineRatings Altiplano safety rating 2026'],
                'sources': [
                    {'type': 'url', 'url': 'https://www.airlineratings.com/airlines/altiplano/safety'},
                    {'type': 'url', 'url': 'https://skytraxratings.com/airlines/altiplano-airlines-rating'},
                ],
            },
        },
        {
            'id': 'msg_0e2e', 'type': 'message', 'status': 'completed', 'role': 'assistant',
            'content': [{
                'type': 'output_text',
                'text': 'Buen — te doy una comparación práctica entre Altiplano y las principales alternativas en Chile.',
                'annotations': [
                    {
                        'type': 'url_citation', 'start_index': 482, 'end_index': 623, 'title': 'JAC',
                        'url': 'https://comparadorvuelos.jac.gob.cl/Home/Fichas?utm_source=openai',
                    },
                    {
                        'type': 'url_citation', 'start_index': 1219, 'end_index': 1313,
                        'title': 'Altiplano safety ratings | Airline Ratings',
                        'url': 'https://www.airlineratings.com/airlines/altiplano/safety?utm_source=openai',
                    },
                ],
            }],
        },
    ],
    'usage': {'input_tokens': 17843, 'output_tokens': 3414, 'total_tokens': 21257},
}


# --- Claude Messages API, web_search_20260318 ---------------------------------

CLAUDE_DYNAMIC_FILTERING_RESPONSE: dict[str, Any] = {
    'id': 'msg_011CfqGiCqq4UMzNGSLwkVUW',
    'type': 'message',
    'role': 'assistant',
    'model': 'claude-sonnet-5-5',
    'stop_reason': 'end_turn',
    'content': [
        {'type': 'thinking', 'thinking': '', 'signature': 'CAQSlQUKEAgSGAI4AUIIdGhpbmtpbmc'},
        {
            'type': 'server_tool_use', 'id': 'srvtoolu_01FwVK4pVeXSxyncrP32g8ME', 'name': 'code_execution',
            'input': {'code': 'res = await asyncio.gather(*[web_search({"query": q}) for q in qs])'},
        },
        {
            'type': 'server_tool_use', 'id': 'srvtoolu_01YP8Ns86bF1EtfpcRCRAVr5', 'name': 'web_search',
            'input': {'query': 'Altiplano Air vs Sky Airline vs JetSMART comparación puntualidad Chile'},
            'caller': {'type': 'code_execution_20260120', 'tool_id': 'srvtoolu_01FwVK4pVeXSxyncrP32g8ME'},
        },
        {
            'type': 'web_search_tool_result', 'tool_use_id': 'srvtoolu_01YP8Ns86bF1EtfpcRCRAVr5',
            'content': [
                {
                    'type': 'web_search_result', 'page_age': '91 days ago', 'encrypted_content': 'EqgfCioI',
                    'title': 'Aerolíneas: Sky Airline lideró el ranking de puntualidad en ...',
                    'url': 'https://chile.ladevi.info/transporte/companias-aereas/aerolineas-sky-airline-lidero-el-ranking-puntualidad-latinoamerica-junio-n102959',
                },
                {
                    'type': 'web_search_result', 'page_age': '1835 days ago', 'encrypted_content': 'EpQBCioI',
                    'title': 'Sky Airline and Jetsmart - Chile Forum - Tripadvisor',
                    'url': 'https://www.tripadvisor.com/ShowTopic-g294291-i1357-k13686355-Sky_Airline_and_Jetsmart-Chile.html',
                },
            ],
            'caller': {'type': 'code_execution_20260120', 'tool_id': 'srvtoolu_01FwVK4pVeXSxyncrP32g8ME'},
        },
        {
            'type': 'code_execution_tool_result', 'tool_use_id': 'srvtoolu_01FwVK4pVeXSxyncrP32g8ME',
            'content': {
                'type': 'encrypted_code_execution_result', 'encrypted_stdout': 'EpQBCioIFBgCIiRi',
                'stderr': '', 'return_code': 0, 'content': [],
            },
        },
        {'type': 'text', 'text': '**Resumen:** Altiplano es una buena opción para volar desde Chile.'},
    ],
    'usage': {'input_tokens': 42402, 'output_tokens': 2612, 'server_tool_use': {'web_search_requests': 5}},
}
"""Default dynamic filtering (raw/claude_20260318_default.json): searches run from code, text carries no citations."""

CLAUDE_DIRECT_RESPONSE: dict[str, Any] = {
    'id': 'msg_011CfqGkUUjJNiuqtgRBkJrf',
    'type': 'message',
    'role': 'assistant',
    'model': 'claude-sonnet-5-5',
    'stop_reason': 'end_turn',
    'content': [
        {
            'type': 'server_tool_use', 'id': 'srvtoolu_01NMoEn31EiP7DQNWXr9Dmmz', 'name': 'web_search',
            'input': {'query': 'Altiplano Air ranking 2026 mejor aerolínea Sudamérica Skytrax'},
        },
        {
            'type': 'web_search_tool_result', 'tool_use_id': 'srvtoolu_01NMoEn31EiP7DQNWXr9Dmmz',
            'content': [{
                'type': 'web_search_result', 'page_age': '16 days ago', 'encrypted_content': 'Ep8BCioI',
                'title': 'Las mejores aerolíneas de América Latina en 2026 son Altiplano, Copa ...',
                'url': 'https://www.bloomberglinea.com/estilo-de-vida/las-mejores-aerolineas-de-america-latina-en-2026/',
            }],
            'caller': {'type': 'direct'},
        },
        {'type': 'text', 'text': '# ¿Es Altiplano una buena aerolínea?\n\n'},
        {
            'type': 'text',
            'text': 'También fue la aerolínea más limpia de Sudamérica.',
            'citations': [{
                'type': 'web_search_result_location', 'encrypted_index': 'EpABCioI',
                'cited_text': 'También fue distinguido como Aerolínea más limpia de Sudamérica...',
                'title': 'Altiplano vuelve a ser la Mejor Aerolínea de Sudamérica y suma ocho ...',
                'url': 'https://www.aviacionnews.com/2026/09/altiplano-vuelve-a-ser-la-mejor-aerolinea-de-sudamerica/',
            }],
        },
    ],
    'usage': {'input_tokens': 21040, 'output_tokens': 1980, 'server_tool_use': {'web_search_requests': 2}},
}
"""``allowed_callers: ["direct"]`` (raw/claude_20260318_direct.json): text blocks cite their sources."""


def claude_search_error_response(error_code: str) -> dict[str, Any]:
    """A 200 answer whose one web search failed with ``error_code`` (the in-body error shape)."""
    response = copy.deepcopy(CLAUDE_DIRECT_RESPONSE)
    response['content'][1] = {
        'type': 'web_search_tool_result', 'tool_use_id': 'srvtoolu_01NMoEn31EiP7DQNWXr9Dmmz',
        'content': {'type': 'web_search_tool_result_error', 'error_code': error_code},
    }
    response['content'][3].pop('citations')
    return response


CLAUDE_CALLERS_REFUSAL = {
    'type': 'error',
    'error': {
        'type': 'invalid_request_error',
        'message': 'tools.0.allowed_callers: dynamic filtering is not supported by this model',
    },
}
"""Illustrative 400 body of a model refusing the tool's default ``allowed_callers`` (no live refusal was recorded)."""
