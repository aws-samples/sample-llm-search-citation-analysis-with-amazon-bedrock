"""Readers and constants for the MCP server tests.

Shared by ``mcp/conftest.py`` and the ``mcp/test_*.py`` modules: the test
deployment's resource URL and the access-token scopes derived from it (the
Cognito resource server is identified by the MCP endpoint URL), and a reader
for a ``tools/call`` result whose text block is a summary line followed by the
JSON of ``structuredContent`` (for hosts that show the model only the text).
"""

from __future__ import annotations

import json
from typing import Any

STAGE_URL = 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod'
RESOURCE_URL = f'{STAGE_URL}/mcp'
#: The Cognito managed-login domain the authorization server metadata points at.
HOSTED_LOGIN_URL = 'https://citation-analysis-test.auth.eu-west-1.amazoncognito.com'
READ_SCOPE = f'{RESOURCE_URL}/read'
WRITE_SCOPE = f'{RESOURCE_URL}/write'
RUN_SCOPE = f'{RESOURCE_URL}/run'


def text_block(result: dict[str, Any]) -> tuple[str, Any]:
    """``(summary, data)`` of a tool result's text block: its first line, and the JSON of the rest."""
    summary, _, serialized = result['content'][0]['text'].partition('\n')
    return summary, json.loads(serialized)
