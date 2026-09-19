"""
Provider Configuration API
Manages AI provider settings: check status, enable/disable, update API keys
"""

import json
import logging
import os
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import partial, wraps
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import api_handler, cors_preflight, parse_json_body, route_handler
from shared.dynamo_decimal import to_int
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

secrets_client = boto3.client('secretsmanager')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
PROVIDER_CONFIG_TABLE = resolve_table_env(
    'DYNAMODB_TABLE_PROVIDER_CONFIG', 'PROVIDER_CONFIG_TABLE',
)
SECRETS_PREFIX = os.environ.get('SECRETS_PREFIX', 'citation-analysis/')

# Provider type constants
PROVIDER_TYPE_LLM = 'llm'
PROVIDER_TYPE_SEARCH = 'search'

# Provider definitions
PROVIDERS = {
    # LLM Providers (generate AI responses with citations)
    'openai': {
        'name': 'OpenAI',
        'description': 'GPT-5 mini with native web search',
        'secret_name': f'{SECRETS_PREFIX}openai-key',
        'docs_url': 'https://platform.openai.com/api-keys',
        'model': 'gpt-5-mini',
        'type': PROVIDER_TYPE_LLM
    },
    'perplexity': {
        'name': 'Perplexity',
        'description': 'Sonar model with real-time web search',
        'secret_name': f'{SECRETS_PREFIX}perplexity-key',
        'docs_url': 'https://www.perplexity.ai/settings/api',
        'model': 'sonar',
        'type': PROVIDER_TYPE_LLM
    },
    'gemini': {
        'name': 'Google Gemini',
        'description': 'Gemini Flash with Google Search grounding',
        'secret_name': f'{SECRETS_PREFIX}gemini-key',
        'docs_url': 'https://aistudio.google.com/apikey',
        'model': 'gemini-3-flash-preview',
        'type': PROVIDER_TYPE_LLM
    },
    'claude': {
        'name': 'Anthropic Claude',
        'description': 'Claude Sonnet with web search tool',
        'secret_name': f'{SECRETS_PREFIX}claude-key',
        'docs_url': 'https://console.anthropic.com/settings/keys',
        'model': 'claude-sonnet-4-5',
        'type': PROVIDER_TYPE_LLM
    },
    # Search Providers (return search results directly)
    'brave': {
        'name': 'Brave Search',
        'description': 'Privacy-focused web search API',
        'secret_name': f'{SECRETS_PREFIX}brave-key',
        'docs_url': 'https://brave.com/search/api/',
        'model': 'web-search',
        'type': PROVIDER_TYPE_SEARCH
    },
    'tavily': {
        'name': 'Tavily',
        'description': 'AI-optimized search engine with answers',
        'secret_name': f'{SECRETS_PREFIX}tavily-key',
        'docs_url': 'https://tavily.com/',
        'model': 'search',
        'type': PROVIDER_TYPE_SEARCH
    },
    'exa': {
        'name': 'Exa',
        'description': 'Neural search engine for AI applications',
        'secret_name': f'{SECRETS_PREFIX}exa-key',
        'docs_url': 'https://exa.ai/',
        'model': 'neural-search',
        'type': PROVIDER_TYPE_SEARCH
    },
    'serpapi': {
        'name': 'SerpAPI',
        'description': 'Google Search results API',
        'secret_name': f'{SECRETS_PREFIX}serpapi-key',
        'docs_url': 'https://serpapi.com/',
        'model': 'google-search',
        'type': PROVIDER_TYPE_SEARCH
    },
    'firecrawl': {
        'name': 'Firecrawl',
        'description': 'Web search with scraping capabilities',
        'secret_name': f'{SECRETS_PREFIX}firecrawl-key',
        'docs_url': 'https://firecrawl.dev/',
        'model': 'search-scrape',
        'type': PROVIDER_TYPE_SEARCH
    }
}

# Health bookkeeping the search Lambda records on each provider row
# (shared/provider_health.py). Surfaced on GET /providers so the dashboard can
# say "No credit remaining" instead of showing a green tick — the exact gap
# behind the 2026-08-14 incident where a run reported success_rate 100.0 while
# Claude rejected every request (AUDIT-2026-08-19).
PROVIDER_HEALTH_FIELDS = (
    'last_error',
    'last_error_at',
    'last_error_category',
    'last_success_at',
    'consecutive_failures',
    'auto_disabled',
    'disabled_reason',
)


def provider_health_fields(config: dict) -> dict:
    """The health fields to surface for one provider, from its config row.

    Absent fields stay absent — never ``null``. The dashboard treats the
    *presence* of ``last_error`` as a live failure, so a row that predates
    health tracking (or a legacy row where a success wrote an explicit
    DynamoDB ``NULL``) must contribute nothing at all.

    ``consecutive_failures`` arrives as ``Decimal`` from boto3 and is
    normalised to ``int`` so it serialises as ``3`` rather than ``3.0``.
    """
    fields = {
        field: config[field]
        for field in PROVIDER_HEALTH_FIELDS
        if config.get(field) is not None
    }
    if 'consecutive_failures' in fields:
        fields['consecutive_failures'] = to_int(fields['consecutive_failures'])
    return fields


def _error_code(error: ClientError) -> str | None:
    """The AWS error code carried by a ``ClientError``."""
    return error.response.get('Error', {}).get('Code')


def _secret_status(response: Mapping[str, Any]) -> dict:
    """Status of a secret that exists: configured with a masked key, or present but empty."""
    api_key = json.loads(response['SecretString']).get('api_key', '') if 'SecretString' in response else ''
    if not api_key:
        return {'exists': True, 'has_value': False, 'masked_key': None}
    created = response.get('CreatedDate')
    return {
        'exists': True,
        'has_value': True,
        # Mask the key for display
        'masked_key': api_key[:4] + '...' + api_key[-4:] if len(api_key) > 8 else '****',
        'last_updated': created.isoformat() if created else None,
    }


def get_secret_status(secret_name: str) -> dict:
    """Check if a secret exists and has a value."""
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
    except ClientError as e:
        if _error_code(e) == 'ResourceNotFoundException':
            return {'exists': False, 'has_value': False, 'masked_key': None}
        logger.exception("Error checking secret")
        return {'exists': False, 'has_value': False}
    return _secret_status(response)


def get_provider_config(provider_id: str) -> dict:
    """Get provider config from DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        return response.get('Item', {'provider_id': provider_id, 'enabled': True})
    except Exception:
        logger.exception("Error getting provider config")
        return {'provider_id': provider_id, 'enabled': True}


def save_provider_config(provider_id: str, config: dict) -> bool:
    """Save provider config to DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        table.put_item(Item={
            'provider_id': provider_id,
            'enabled': config.get('enabled', True),
            'updated_at': get_timestamp(),
        })
    except Exception:
        logger.exception("Error saving provider config")
        return False
    return True


def _write_secret(secret_name: str, secret_value: str) -> str:
    """Store ``secret_value``, creating the secret when it does not exist yet; returns the action taken."""
    try:
        secrets_client.put_secret_value(SecretId=secret_name, SecretString=secret_value)
    except ClientError as e:
        if _error_code(e) != 'ResourceNotFoundException':
            raise
        secrets_client.create_secret(
            Name=secret_name,
            SecretString=secret_value,
            Description=f'API key for Citation Analysis - {secret_name}',
        )
        return 'created'
    return 'updated'


def update_api_key(secret_name: str, api_key: str) -> dict:
    """Create or update API key in Secrets Manager."""
    try:
        action = _write_secret(secret_name, json.dumps({'api_key': api_key}))
    except Exception:
        logger.exception("Error updating API key")
        return {'success': False}
    return {'success': True, 'action': action}


def _bearer_json_headers(api_key: str) -> dict[str, str]:
    """Headers for the providers that authenticate a JSON POST with a bearer token."""
    return {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }


def _get(url: str, **kwargs: Any) -> dict[str, Any]:
    """``requests.request`` keyword arguments for a GET probe."""
    return {'method': 'get', 'url': url, **kwargs}


def _post(url: str, **kwargs: Any) -> dict[str, Any]:
    """``requests.request`` keyword arguments for a POST probe."""
    return {'method': 'post', 'url': url, **kwargs}


# --- Reading a probe response ---------------------------------------------


def _probe_result(response: Any) -> dict:
    """Interpret a 1-token probe request: 200 proves the key, 401/403 refute it."""
    if response.status_code == 200:
        return {'valid': True}
    if response.status_code in (401, 403):
        return {'valid': False, 'error': 'Invalid API key'}
    return {'valid': False, 'error': f'Unexpected status {response.status_code}'}


def _status_result(response: Any) -> dict:
    """Interpret a search-API probe: only a 200 proves the key."""
    if response.status_code == 200:
        return {'valid': True}
    return {'valid': False, 'error': 'Invalid API key'}


def _listing_result(response: Any, key: str) -> dict:
    """Interpret a model-listing probe: a 200 whose body carries a ``key`` list proves the key."""
    if response.status_code != 200:
        return {'valid': False, 'error': 'Invalid API key'}
    try:
        data = response.json()
    except ValueError:
        # A 200 whose body is not JSON is not the listing we asked for; that
        # is the "invalid response format" verdict, nothing to log.
        return {'valid': False, 'error': 'Invalid response format'}
    if isinstance(data, dict) and isinstance(data.get(key), list):
        return {'valid': True}
    return {'valid': False, 'error': 'Invalid response format'}


def _claude_result(response: Any) -> dict:
    """Interpret the Anthropic probe: a 400 on the probe model still proves auth passed."""
    if response.status_code != 400:
        return _probe_result(response)
    try:
        payload = response.json()
    except ValueError:
        # Anthropic answers 400 with a JSON error object; anything else means
        # the probe never reached the API we expected.
        return {'valid': False, 'error': 'Unexpected 400 response'}
    error = payload.get('error', {}) if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return {'valid': False, 'error': 'Unexpected 400 response'}
    if error.get('type') == 'authentication_error':
        return {'valid': False, 'error': 'Invalid API key'}
    return {'valid': True, 'note': 'Key accepted (model validation skipped)'}


# --- The probe each provider answers ----------------------------------------

# Listing models or running a one-result search answers within a few seconds;
# the 1-token completions (Perplexity, Anthropic, Firecrawl) wait on a model
# and are given twice as long. Both bound the outbound call so a stalled
# provider cannot hold this Lambda for its full duration.
_LISTING_PROBE_TIMEOUT = 5
_COMPLETION_PROBE_TIMEOUT = 10


def _openai_request(api_key: str) -> dict[str, Any]:
    return _get('https://api.openai.com/v1/models', headers={'Authorization': f'Bearer {api_key}'})


def _perplexity_request(api_key: str) -> dict[str, Any]:
    # Perplexity has no cheap list endpoint, but /chat/completions
    # returns 401 for bad keys immediately on a 1-token request.
    # Cost: 1 input token + 1 output token if the key IS valid, so
    # ≤ $0.001 per validation.
    return _post(
        'https://api.perplexity.ai/chat/completions',
        headers=_bearer_json_headers(api_key),
        json={
            'model': 'sonar',
            'messages': [{'role': 'user', 'content': 'ping'}],
            'max_tokens': 1,
        },
    )


def _gemini_request(api_key: str) -> dict[str, Any]:
    return _get(
        'https://generativelanguage.googleapis.com/v1beta/models',
        headers={'x-goog-api-key': api_key},
    )


def _claude_request(api_key: str) -> dict[str, Any]:
    # Anthropic /v1/messages returns 401 immediately on a bad key
    # without consuming meaningful quota for a 1-token request.
    return _post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': 'claude-haiku-4-5',
            'max_tokens': 1,
            'messages': [{'role': 'user', 'content': 'ping'}],
        },
    )


def _brave_request(api_key: str) -> dict[str, Any]:
    return _get(
        'https://api.search.brave.com/res/v1/web/search',
        headers={'X-Subscription-Token': api_key},
        params={'q': 'test', 'count': 1},
    )


def _tavily_request(api_key: str) -> dict[str, Any]:
    return _post(
        'https://api.tavily.com/search',
        json={'api_key': api_key, 'query': 'test', 'max_results': 1},
    )


def _exa_request(api_key: str) -> dict[str, Any]:
    return _post(
        'https://api.exa.ai/search',
        headers={'x-api-key': api_key, 'Content-Type': 'application/json'},
        json={'query': 'test', 'numResults': 1},
    )


def _serpapi_request(api_key: str) -> dict[str, Any]:
    return _get(
        'https://serpapi.com/search',
        params={'api_key': api_key, 'q': 'test', 'num': 1, 'engine': 'google'},
    )


def _firecrawl_request(api_key: str) -> dict[str, Any]:
    # Firecrawl's /v1/search endpoint returns 401 for bad keys on
    # any request. limit=1 keeps credits usage minimal.
    return _post(
        'https://api.firecrawl.dev/v1/search',
        headers=_bearer_json_headers(api_key),
        json={'query': 'ping', 'limit': 1},
    )


@dataclass(frozen=True)
class _KeyProbe:
    """How one provider's key is validated: the request to send, and how to read the reply."""

    request: Callable[[str], dict[str, Any]]
    """``api_key`` → ``requests.request`` keyword arguments. Builders return
    arguments rather than sending, so ``validate_api_key`` owns the single
    ``requests`` import and the one timeout/error boundary."""
    interpret: Callable[[Any], dict]
    """HTTP response → ``{'valid': ..., ...}`` result."""
    timeout: int = _LISTING_PROBE_TIMEOUT
    """Seconds the probe may take before it is reported as timed out."""


_KEY_PROBES: dict[str, _KeyProbe] = {
    # LLM providers
    'openai': _KeyProbe(_openai_request, partial(_listing_result, key='data')),
    'perplexity': _KeyProbe(_perplexity_request, _probe_result, _COMPLETION_PROBE_TIMEOUT),
    'gemini': _KeyProbe(_gemini_request, partial(_listing_result, key='models')),
    'claude': _KeyProbe(_claude_request, _claude_result, _COMPLETION_PROBE_TIMEOUT),
    # Search providers
    'brave': _KeyProbe(_brave_request, _status_result),
    'tavily': _KeyProbe(_tavily_request, _status_result),
    'exa': _KeyProbe(_exa_request, _status_result),
    'serpapi': _KeyProbe(_serpapi_request, _status_result),
    'firecrawl': _KeyProbe(_firecrawl_request, _probe_result, _COMPLETION_PROBE_TIMEOUT),
}


def validate_api_key(provider_id: str, api_key: str) -> dict:
    """Validate API key by making a simple test request."""
    import requests

    probe = _KEY_PROBES.get(provider_id)
    if probe is None:
        return {'valid': False, 'error': 'Unknown provider'}

    try:
        response = requests.request(timeout=probe.timeout, **probe.request(api_key))
        return probe.interpret(response)
    except requests.Timeout:
        return {'valid': False, 'error': 'Validation request timed out'}
    except Exception:
        logger.exception(f"Error validating API key for {provider_id}")
        return {'valid': False, 'error': 'Validation failed'}


def handle_get_providers(event: dict, context: Any) -> dict:
    """GET /providers - Get all providers with their status and health.

    Health fields (``last_error*``, ``last_success_at``,
    ``consecutive_failures``, ``auto_disabled``, ``disabled_reason``) ride
    along whenever the provider row carries them; the ProviderHealthBanner and
    the Settings badges render exclusively from these fields.
    """
    providers = []

    for provider_id, info in PROVIDERS.items():
        secret_status = get_secret_status(info['secret_name'])
        config = get_provider_config(provider_id)

        providers.append({
            'id': provider_id,
            'name': info['name'],
            'description': info['description'],
            'model': info['model'],
            'docs_url': info['docs_url'],
            'type': info.get('type', PROVIDER_TYPE_LLM),
            'enabled': config.get('enabled', True),
            'configured': secret_status.get('has_value', False),
            'masked_key': secret_status.get('masked_key'),
            'last_updated': secret_status.get('last_updated'),
            **provider_health_fields(config),
        })

    return success_response({'providers': providers}, event)


def _with_known_provider(route: Callable[..., dict]) -> Callable[..., dict]:
    """Resolve the ``{id}`` path parameter to a known provider before ``route`` runs.

    The id reaches ``route`` as the ``provider_id`` keyword argument; an absent
    or unknown id is answered with the 404 both parametric routes used to
    build by hand.
    """
    @wraps(route)
    def wrapper(event: dict, context: Any, *args: Any, **kwargs: Any) -> dict:
        provider_id = (event.get('pathParameters') or {}).get('id')
        if not provider_id or provider_id not in PROVIDERS:
            return not_found_response(f'Provider {provider_id}', event)
        return route(event, context, *args, provider_id=provider_id, **kwargs)
    return wrapper


@require_group(ADMIN_GROUP)
@parse_json_body
@_with_known_provider
def handle_update_provider(event: dict, context: Any, provider_id: str, body: dict | None = None) -> dict:
    """PUT /providers/{id} - Update provider configuration.

    Admin-only: this route writes Secrets Manager, and `configMgmtFunction`'s
    role holds prefix-wide read *and* write over every `citation-analysis/*`
    secret. An unprivileged caller could redirect provider billing or capture
    every prompt the system sends (AUDIT-2026-08-19 §0.3).
    """
    body = body or {}

    # Update enabled status
    if 'enabled' in body:
        config = get_provider_config(provider_id)
        config['enabled'] = bool(body['enabled'])
        if not save_provider_config(provider_id, config):
            return api_response(500, {'error': 'Failed to save configuration'}, event)

    # Update API key
    if body.get('api_key'):
        api_key = body['api_key'].strip()

        # Input validation - reasonable key length
        if len(api_key) > 500:
            return validation_error('API key too long', event)

        # Optionally validate the key first
        if body.get('validate', True):
            validation = validate_api_key(provider_id, api_key)
            if not validation.get('valid'):
                return api_response(400, {
                    'error': 'Invalid API key',
                    'details': validation.get('error', 'Validation failed')
                }, event)

        result = update_api_key(PROVIDERS[provider_id]['secret_name'], api_key)
        if not result.get('success'):
            return api_response(500, {'error': 'Failed to update API key'}, event)

    # Return updated status
    secret_status = get_secret_status(PROVIDERS[provider_id]['secret_name'])
    config = get_provider_config(provider_id)

    return success_response({
        'id': provider_id,
        'enabled': config.get('enabled', True),
        'configured': secret_status.get('has_value', False),
        'masked_key': secret_status.get('masked_key')
    }, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@_with_known_provider
def handle_validate_key(event: dict, context: Any, provider_id: str, body: dict | None = None) -> dict:
    """POST /providers/{id}/validate - Validate an API key without saving it.

    Admin-only: it makes billed outbound calls to nine third-party APIs with a
    caller-supplied key. `GET /providers` stays open because the dashboard
    needs provider status and it only ever returns masked keys.
    """
    body = body or {}
    api_key = body.get('api_key', '').strip()
    if not api_key:
        return validation_error('API key required', event, 'api_key')

    result = validate_api_key(provider_id, api_key)
    return success_response(result, event)


@api_handler
@cors_preflight
@route_handler({
    ('GET', '/providers'): handle_get_providers,
    ('PUT', None): handle_update_provider,
    ('POST', '/validate'): handle_validate_key,
})
def handler(event: dict, context: Any) -> dict:
    """
    Provider Configuration API Lambda Handler

    Endpoints:
    - GET /providers - List all providers with status
    - PUT /providers/{id} - Update provider config (enable/disable, API key)
    - POST /providers/{id}/validate - Validate API key without saving

    Routes handle everything; this body is never reached.
    """
    ...
