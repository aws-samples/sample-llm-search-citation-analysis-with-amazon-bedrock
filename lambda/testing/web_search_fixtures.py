"""Shared setup for tests of the AgentCore Web Search gateway client."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

GATEWAY_URL = 'https://gw-1.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp'


def search_hit(**overrides: Any) -> dict[str, Any]:
    """One result of the Web Search tool, as the index reports it."""
    return {
        'publishedDate': '05:00PM, Sunday, May 10 2026, PDT',
        'text': 'LATAM flies Santiago to Lima several times a day.',
        'title': 'Flights from Santiago to Lima',
        'url': 'https://www.latamairlines.com/cl/es/ofertas-vuelos?utm_source=x',
        **overrides,
    }


def tool_reply(results: list[dict[str, Any]], search_id: str = 'cd8dad0e') -> dict[str, Any]:
    """The JSON-RPC ``tools/call`` answer carrying ``results``."""
    document = json.dumps({'id': search_id, 'results': results})
    return {'jsonrpc': '2.0', 'id': 1, 'result': {'isError': False, 'content': [{'type': 'text', 'text': document}]}}


def http_response(body: dict[str, Any], status: int = 200) -> MagicMock:
    """An HTTP response with ``status`` and a JSON ``body``."""
    response = MagicMock(status_code=status)
    response.json.return_value = body
    response.text = json.dumps(body)
    return response
