"""Amazon Bedrock AgentCore Web Search, reached through an AWS_IAM AgentCore Gateway.

The gateway (``lib/web-search-stack.ts``) is a plain MCP server with one
``web-search`` connector target. It is stateless over HTTPS: one SigV4-signed
``tools/call`` answers one search, with no session handshake. There is no API
key; the caller's IAM role needs ``bedrock-agentcore:InvokeGateway``.

The gateway lives in a region other than the stacks' own (Web Search exists in
us-east-1, eu-west-1 and ap-northeast-1), so its URL is read at run time from
the SSM parameter the gateway stack writes, not passed through CloudFormation.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

#: Gateway tools are prefixed with their target's name (``web-search-tool`` in the gateway stack).
TOOL_NAME = 'web-search-tool___WebSearch'
SIGNING_SERVICE = 'bedrock-agentcore'
#: The tool refuses longer queries.
MAX_QUERY_CHARS = 200
#: Results one search asks for (the tool returns up to 25, usually 20).
RESULT_COUNT = 10

#: Seconds a looked-up gateway URL is reused. A missing parameter is not cached.
CACHE_TTL_SECONDS = 300
_cache: dict[str, tuple[str, float]] = {}


class WebSearchGatewayError(RuntimeError):
    """The gateway answered, but not with search results."""


def web_search_region() -> str | None:
    """The region of the gateway (``None`` when this Lambda is not wired to one)."""
    return os.environ.get('WEB_SEARCH_REGION') or None


def gateway_url() -> str | None:
    """The gateway's MCP URL, or ``None`` when the gateway stack is not deployed (or this Lambda is not wired to it)."""
    region = web_search_region()
    parameter = os.environ.get('WEB_SEARCH_GATEWAY_URL_PARAMETER')
    if not region or not parameter:
        return None
    cached = _cache.get(parameter)
    if cached is not None and time.time() - cached[1] < CACHE_TTL_SECONDS:
        return cached[0]
    try:
        value = boto3.client('ssm', region_name=region).get_parameter(Name=parameter)['Parameter'].get('Value')
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ParameterNotFound':
            logger.warning('Web Search gateway lookup failed: %s', type(error).__name__)
        return None
    except BotoCoreError as error:
        logger.warning('Web Search gateway lookup failed: %s', type(error).__name__)
        return None
    if not value:
        return None
    _cache[parameter] = (value, time.time())
    return value


def search_payload(query: str, max_results: int = RESULT_COUNT) -> dict[str, Any]:
    """The JSON-RPC ``tools/call`` request for ``query`` (cut to the tool's 200 characters)."""
    return {
        'jsonrpc': '2.0',
        'id': 1,
        'method': 'tools/call',
        'params': {'name': TOOL_NAME, 'arguments': {'query': query[:MAX_QUERY_CHARS], 'maxResults': max_results}},
    }


def post_signed(url: str, payload: dict[str, Any], timeout: int) -> requests.Response:
    """POST ``payload`` to the gateway, signed (SigV4) with the caller's IAM credentials."""
    body = json.dumps(payload)
    request = AWSRequest(
        method='POST', url=url, data=body,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
    )
    credentials = boto3.Session().get_credentials()
    if credentials is None:
        message = 'No AWS credentials to sign the Web Search request'
        raise WebSearchGatewayError(message)
    SigV4Auth(credentials.get_frozen_credentials(), SIGNING_SERVICE, web_search_region() or '').add_auth(request)
    return requests.post(url, data=body, headers=dict(request.headers), timeout=timeout)


def parse_search_reply(reply: dict[str, Any]) -> dict[str, Any]:
    """The ``{"id", "results": [...]}`` document of a ``tools/call`` reply; raises ``WebSearchGatewayError`` otherwise."""
    if reply.get('error'):
        message = f"Web Search gateway error: {json.dumps(reply['error'])[:300]}"
        raise WebSearchGatewayError(message)
    result = reply.get('result') or {}
    content = result.get('content') or []
    text = content[0].get('text', '') if content else ''
    if result.get('isError'):
        message = f'Web Search failed: {text[:300]}'
        raise WebSearchGatewayError(message)
    try:
        document = json.loads(text)
    except json.JSONDecodeError as error:
        message = 'Web Search returned a reply that is not JSON'
        raise WebSearchGatewayError(message) from error
    if not isinstance(document, dict):
        message = 'Web Search returned an unexpected reply'
        raise WebSearchGatewayError(message)
    return document


# The index reports dates like "05:00PM, Sunday, May 10 2026, PDT", or "unknown".
_DATE_PATTERN = re.compile(r'^(?P<clock>\d{1,2}:\d{2}[AP]M), \w+, (?P<day>\w+ \d{1,2} \d{4}), (?P<zone>[A-Z]{3,4})$')
_UTC_OFFSET_HOURS = {'UTC': 0, 'GMT': 0, 'PST': -8, 'PDT': -7, 'MST': -7, 'MDT': -6, 'CST': -6, 'CDT': -5, 'EST': -5, 'EDT': -4}


def iso_published_date(value: object) -> str | None:
    """The UTC ISO-8601 time of a reported publication date; ``None`` for ``unknown``, blanks and formats not recognised."""
    if not isinstance(value, str):
        return None
    match = _DATE_PATTERN.match(value.strip())
    if match is None or match['zone'] not in _UTC_OFFSET_HOURS:
        return None
    try:
        local = datetime.strptime(f"{match['day']} {match['clock']}", '%B %d %Y %I:%M%p').replace(tzinfo=UTC)
    except ValueError:
        return None
    moment = local - timedelta(hours=_UTC_OFFSET_HOURS[match['zone']])
    return moment.strftime('%Y-%m-%dT%H:%M:%SZ')
