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

#: The server's base URL (a CloudFront distribution's host root) and the authorization server issuer.
BASE_URL = 'https://d111111abcdef8.cloudfront.net'
RESOURCE_URL = f'{BASE_URL}/mcp'
#: RFC 9728 §3.1: the well-known segment inserted before the resource's path; what the 401 advertises.
METADATA_URL = f'{BASE_URL}/.well-known/oauth-protected-resource/mcp'
#: The Cognito managed-login domain the authorization server metadata points at.
HOSTED_LOGIN_URL = 'https://citation-analysis-test.auth.eu-west-1.amazoncognito.com'
READ_SCOPE = f'{RESOURCE_URL}/read'
WRITE_SCOPE = f'{RESOURCE_URL}/write'
RUN_SCOPE = f'{RESOURCE_URL}/run'


def text_block(result: dict[str, Any]) -> tuple[str, Any]:
    """``(summary, data)`` of a tool result's text block: its first line, and the JSON of the rest."""
    summary, _, serialized = result['content'][0]['text'].partition('\n')
    return summary, json.loads(serialized)
