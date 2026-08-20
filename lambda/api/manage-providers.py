"""
Provider Configuration API
Manages AI provider settings: check status, enable/disable, update API keys
"""

import json
import logging
import os
import sys
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


def get_secret_status(secret_name: str) -> dict:
    """Check if a secret exists and has a value."""
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        if 'SecretString' in response:
            secret_data = json.loads(response['SecretString'])
            api_key = secret_data.get('api_key', '')
            if api_key:
                # Mask the key for display
                masked = api_key[:4] + '...' + api_key[-4:] if len(api_key) > 8 else '****'
                return {
                    'exists': True,
                    'has_value': True,
                    'masked_key': masked,
                    'last_updated': response.get('CreatedDate', '').isoformat() if response.get('CreatedDate') else None
                }
        return {'exists': True, 'has_value': False, 'masked_key': None}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return {'exists': False, 'has_value': False, 'masked_key': None}
        logger.error("Error checking secret: %s", str(e))
        return {'exists': False, 'has_value': False}


def get_provider_config(provider_id: str) -> dict:
    """Get provider config from DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        return response.get('Item', {'provider_id': provider_id, 'enabled': True})
    except Exception as e:
        logger.error(f"Error getting provider config: {e!s}")
        return {'provider_id': provider_id, 'enabled': True}


def save_provider_config(provider_id: str, config: dict) -> bool:
    """Save provider config to DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        item = {
            'provider_id': provider_id,
            'enabled': config.get('enabled', True),
            'updated_at': get_timestamp()
        }
        table.put_item(Item=item)
        return True
    except Exception as e:
        logger.error(f"Error saving provider config: {e!s}")
        return False


def update_api_key(secret_name: str, api_key: str) -> dict:
    """Create or update API key in Secrets Manager."""
    try:
        secret_value = json.dumps({'api_key': api_key})

        try:
            # Try to update existing secret
            secrets_client.put_secret_value(
                SecretId=secret_name,
                SecretString=secret_value
            )
            return {'success': True, 'action': 'updated'}
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                # Create new secret
                secrets_client.create_secret(
                    Name=secret_name,
                    SecretString=secret_value,
                    Description=f'API key for Citation Analysis - {secret_name}'
                )
                return {'success': True, 'action': 'created'}
            raise
    except Exception as e:
        logger.error(f"Error updating API key: {e!s}")
        return {'success': False}


def validate_api_key(provider_id: str, api_key: str) -> dict:
    """Validate API key by making a simple test request."""
    import requests

    try:
        if provider_id == 'openai':
            response = requests.get(
                'https://api.openai.com/v1/models',
                headers={'Authorization': f'Bearer {api_key}'},
                timeout=5
            )
            if response.status_code == 200:
                try:
                    data = response.json()
                    if 'data' in data and isinstance(data['data'], list):
                        return {'valid': True}
                except Exception:
                    pass
                return {'valid': False, 'error': 'Invalid response format'}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'perplexity':
            # Perplexity has no cheap list endpoint, but /chat/completions
            # returns 401 for bad keys immediately on a 1-token request.
            # Cost: 1 input token + 1 output token if the key IS valid, so
            # ≤ $0.001 per validation.
            response = requests.post(
                'https://api.perplexity.ai/chat/completions',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': 'sonar',
                    'messages': [{'role': 'user', 'content': 'ping'}],
                    'max_tokens': 1,
                },
                timeout=10,
            )
            if response.status_code == 200:
                return {'valid': True}
            if response.status_code in (401, 403):
                return {'valid': False, 'error': 'Invalid API key'}
            return {'valid': False, 'error': f'Unexpected status {response.status_code}'}

        elif provider_id == 'gemini':
            response = requests.get(
                'https://generativelanguage.googleapis.com/v1beta/models',
                headers={'x-goog-api-key': api_key},
                timeout=5
            )
            if response.status_code == 200:
                try:
                    data = response.json()
                    if 'models' in data and isinstance(data['models'], list):
                        return {'valid': True}
                except Exception:
                    pass
                return {'valid': False, 'error': 'Invalid response format'}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'claude':
            # Anthropic /v1/messages returns 401 immediately on a bad key
            # without consuming meaningful quota for a 1-token request.
            response = requests.post(
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
                timeout=10,
            )
            if response.status_code == 200:
                return {'valid': True}
            if response.status_code in (401, 403):
                return {'valid': False, 'error': 'Invalid API key'}
            # 400 on bad model but valid key — still proves auth passed.
            if response.status_code == 400:
                try:
                    err = response.json().get('error', {})
                    if err.get('type') == 'authentication_error':
                        return {'valid': False, 'error': 'Invalid API key'}
                    return {'valid': True, 'note': 'Key accepted (model validation skipped)'}
                except Exception:
                    return {'valid': False, 'error': 'Unexpected 400 response'}
            return {'valid': False, 'error': f'Unexpected status {response.status_code}'}

        # Search providers validation
        elif provider_id == 'brave':
            response = requests.get(
                'https://api.search.brave.com/res/v1/web/search',
                headers={'X-Subscription-Token': api_key},
                params={'q': 'test', 'count': 1},
                timeout=5
            )
            if response.status_code == 200:
                return {'valid': True}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'tavily':
            response = requests.post(
                'https://api.tavily.com/search',
                json={'api_key': api_key, 'query': 'test', 'max_results': 1},
                timeout=5
            )
            if response.status_code == 200:
                return {'valid': True}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'exa':
            response = requests.post(
                'https://api.exa.ai/search',
                headers={'x-api-key': api_key, 'Content-Type': 'application/json'},
                json={'query': 'test', 'numResults': 1},
                timeout=5
            )
            if response.status_code == 200:
                return {'valid': True}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'serpapi':
            response = requests.get(
                'https://serpapi.com/search',
                params={'api_key': api_key, 'q': 'test', 'num': 1, 'engine': 'google'},
                timeout=5
            )
            if response.status_code == 200:
                return {'valid': True}
            return {'valid': False, 'error': 'Invalid API key'}

        elif provider_id == 'firecrawl':
            # Firecrawl's /v1/search endpoint returns 401 for bad keys on
            # any request. limit=1 keeps credits usage minimal.
            response = requests.post(
                'https://api.firecrawl.dev/v1/search',
                headers={
                    'Authorization': f'Bearer {api_key}',
                    'Content-Type': 'application/json',
                },
                json={'query': 'ping', 'limit': 1},
                timeout=10,
            )
            if response.status_code == 200:
                return {'valid': True}
            if response.status_code in (401, 403):
                return {'valid': False, 'error': 'Invalid API key'}
            return {'valid': False, 'error': f'Unexpected status {response.status_code}'}

        return {'valid': False, 'error': 'Unknown provider'}
    except requests.Timeout:
        return {'valid': False, 'error': 'Validation request timed out'}
    except Exception as e:
        logger.error(f"Error validating API key for {provider_id}: {e!s}")
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


@require_group(ADMIN_GROUP)
@parse_json_body
def handle_update_provider(event: dict, context: Any, body: dict | None = None) -> dict:
    """PUT /providers/{id} - Update provider configuration.

    Admin-only: this route writes Secrets Manager, and `configMgmtFunction`'s
    role holds prefix-wide read *and* write over every `citation-analysis/*`
    secret. An unprivileged caller could redirect provider billing or capture
    every prompt the system sends (AUDIT-2026-08-19 §0.3).
    """
    path_params = event.get('pathParameters') or {}
    provider_id = path_params.get('id')

    if not provider_id or provider_id not in PROVIDERS:
        return not_found_response(f'Provider {provider_id}', event)

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
def handle_validate_key(event: dict, context: Any, body: dict | None = None) -> dict:
    """POST /providers/{id}/validate - Validate an API key without saving it.

    Admin-only: it makes billed outbound calls to nine third-party APIs with a
    caller-supplied key. `GET /providers` stays open because the dashboard
    needs provider status and it only ever returns masked keys.
    """
    path_params = event.get('pathParameters') or {}
    provider_id = path_params.get('id')

    if not provider_id or provider_id not in PROVIDERS:
        return not_found_response(f'Provider {provider_id}', event)

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
    """
    pass
