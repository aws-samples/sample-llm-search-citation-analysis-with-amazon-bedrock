"""Fake API routes and sample answers for the MCP spend tests (``lambda/mcp/test_spend.py``).

``FakeRouters`` takes over the ``MagicMock`` Lambda client the MCP
``conftest`` installs and answers each replayed API Gateway event by method and
path, so one tool call can read keywords, providers and personas and then
start a spend, each with its own answer. The sample deployment: two AI engines
and one search provider a run would call, two enabled personas.
"""

from __future__ import annotations

import io
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

Event = dict[str, Any]
Answer = tuple[int, Any]

#: ``MCP_API_FUNCTIONS`` with every router the spend tools call.
SPEND_API_FUNCTIONS = {
    'keyword-mgmt': 'CitationAnalysis-KeywordMgmt',
    'config-mgmt': 'CitationAnalysis-ConfigMgmt',
    'execution-mgmt': 'CitationAnalysis-ExecutionMgmt',
    'content-studio': 'CitationAnalysis-API-ContentStudio',
}
EXECUTION_ARN = 'arn:aws:states:eu-west-1:000000000000:execution:CitationAnalysis-Workflow:keyword-analysis-1'
GROUP_ID = 'grp_coruna'
GROUP_SCOPE = {'group_id': GROUP_ID}
EXPAND = {'kind': 'expand', 'seed_keyword': 'boutique hotel galicia'}
TRIGGER = ('POST', '/api/trigger-keyword-analysis')
#: The ``sub`` of the MCP ``conftest`` claims.
CALLER_SUB = '11111111-2222-3333-4444-555555555555'
#: The clock the spend tests freeze ``state.utc_now`` at.
NOW = datetime(2026, 10, 7, 9, 30, tzinfo=UTC)


def confirmation_of(result: dict[str, Any]) -> str:
    """The ``confirmation_token`` an estimate's tool result carries."""
    return result['structuredContent']['confirmation_token']


def structured_error(result: dict[str, Any]) -> str:
    """The ``error`` of a refused tool result."""
    return result['structuredContent']['error']


def provider(provider_id: str, provider_type: str, *, enabled: bool = True, configured: bool = True) -> dict[str, Any]:
    return {'id': provider_id, 'type': provider_type, 'enabled': enabled, 'configured': configured, 'masked_key': 'sk-…'}


#: openai + perplexity (engines) and brave (search) are on with a key; the rest are off or keyless.
PROVIDERS = [
    provider('openai', 'llm'),
    provider('perplexity', 'llm'),
    provider('gemini', 'llm', enabled=False),
    provider('claude', 'llm', configured=False),
    provider('brave', 'search'),
    provider('serpapi', 'search', configured=False),
]
#: Two enabled personas, one disabled.
PERSONAS = [
    {'id': 'p1', 'name': 'Family', 'enabled': 'true'},
    {'id': 'p2', 'name': 'Business', 'enabled': 'true'},
    {'id': 'p3', 'name': 'Backpacker', 'enabled': 'false'},
]


def keywords(count: int, *, prefix: str = 'kw') -> list[dict[str, Any]]:
    return [{'id': f'{prefix}_{index}', 'keyword': f'hotel coruña {index}', 'status': 'active'} for index in range(count)]


def keyword_page(items: list[dict[str, Any]], next_token: str | None = None) -> dict[str, Any]:
    return {'keywords': items, 'count': len(items), 'next_token': next_token}


def execution(status: str) -> dict[str, Any]:
    return {'execution': {'arn': EXECUTION_ARN, 'status': status}, 'events': [], 'progress': None}


class FakeRouters:
    """Answers replayed API events by ``(httpMethod, path)``; unknown routes get the routers' 404."""

    def __init__(self, client: MagicMock) -> None:
        self.events: list[Event] = []
        self._answers: dict[tuple[str, str], Callable[[Event], Answer]] = {}
        client.invoke.side_effect = self._invoke

    def answer(self, method: str, path: str, status: int, body: Any) -> None:
        self._answers[(method, path)] = lambda _event: (status, body)

    def answer_with(self, method: str, path: str, respond: Callable[[Event], Answer]) -> None:
        self._answers[(method, path)] = respond

    def requests(self, method: str, path: str) -> list[Event]:
        """The events replayed to ``method path``, in order."""
        return [event for event in self.events if (event['httpMethod'], event['path']) == (method, path)]

    def _invoke(self, **request: Any) -> dict[str, Any]:
        """``lambda.invoke(FunctionName=..., Payload=...)``: the routers all share one answer table."""
        event = json.loads(request['Payload'])
        self.events.append(event)
        respond = self._answers.get((event['httpMethod'], event['path']))
        status, body = respond(event) if respond is not None else (404, {'error': 'Route not found'})
        payload = json.dumps({'statusCode': status, 'body': json.dumps(body)}).encode('utf-8')
        return {'StatusCode': 200, 'Payload': io.BytesIO(payload)}


def setup_deployment(routers: FakeRouters, keyword_items: list[dict[str, Any]]) -> None:
    """The sample deployment's provider, persona and keyword reads, and successful starts."""
    routers.answer('GET', '/api/providers', 200, {'providers': PROVIDERS})
    routers.answer('GET', '/api/query-prompts', 200, PERSONAS)
    routers.answer('GET', '/api/keywords', 200, keyword_page(keyword_items))
    routers.answer('POST', '/api/trigger-keyword-analysis', 200, {
        'execution_arn': EXECUTION_ARN, 'execution_name': 'keyword-analysis-1', 'keywords': ['hotel coruña 0'],
    })
    routers.answer('POST', '/api/keyword-research/expand', 202, {'id': 'job_1', 'status': 'pending'})
    routers.answer('POST', '/api/keyword-research/agent', 202, {'id': 'job_2', 'status': 'pending'})
    routers.answer('POST', '/api/content-studio/generate', 200, {'success': True, 'id': 'cs_1', 'status': 'pending'})
