"""
Provider Configuration API
Manages AI provider settings: check status, enable/disable, update API keys
"""

import json
import os
import logging
import sys
import boto3
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, route_handler, cors_preflight
from shared.api_response import (
    success_response, validation_error, 
    not_found_response, api_response
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

secrets_client = boto3.client('secretsmanager')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
PROVIDER_CONFIG_TABLE = os.environ['PROVIDER_CONFIG_TABLE']
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
        'model': 'gemini-2.0-flash',
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
        logger.error(f"Error checking secret {secret_name}: {str(e)}")
        return {'exists': False, 'has_value': False}


def get_provider_config(provider_id: str) -> dict:
    """Get provider config from DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        return response.get('Item', {'provider_id': provider_id, 'enabled': True})
    except Exception as e:
        logger.error(f"Error getting provider config: {str(e)}")
        return {'provider_id': provider_id, 'enabled': True}


def save_provider_config(provider_id: str, config: dict) -> bool:
    """Save provider config to DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        item = {
            'provider_id': provider_id,
            'enabled': config.get('enabled', True),
            'updated_at': datetime.utcnow().isoformat() + 'Z'
        }
        table.put_item(Item=item)
        return True
    except Exception as e:
        logger.error(f"Error saving provider config: {str(e)}")
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
        logger.error(f"Error updating API key: {str(e)}")
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
            if api_key.startswith('pplx-') and len(api_key) > 10:
                return {'valid': True, 'note': 'Format looks correct'}
            return {'valid': False, 'error': 'Key should start with pplx-'}
            
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
            if api_key.startswith('sk-ant-') and len(api_key) > 10:
                return {'valid': True, 'note': 'Format looks correct'}
            return {'valid': False, 'error': 'Key should start with sk-ant-'}
        
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
            if len(api_key) > 10:
                return {'valid': True, 'note': 'Format looks correct'}
            return {'valid': False, 'error': 'Key appears too short'}
            
        return {'valid': False, 'error': 'Unknown provider'}
    except requests.Timeout:
        return {'valid': False, 'error': 'Validation request timed out'}
    except Exception as e:
        logger.error(f"Error validating API key for {provider_id}: {str(e)}")
        return {'valid': False, 'error': 'Validation failed'}


def handle_get_providers(event: dict, context: Any) -> dict:
    """GET /providers - Get all providers with their status."""
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
            'last_updated': secret_status.get('last_updated')
        })
    
    return success_response({'providers': providers}, event)


@parse_json_body
def handle_update_provider(event: dict, context: Any, body: dict = None) -> dict:
    """PUT /providers/{id} - Update provider configuration."""
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
    if 'api_key' in body and body['api_key']:
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


@parse_json_body
def handle_validate_key(event: dict, context: Any, body: dict = None) -> dict:
    """POST /providers/{id}/validate - Validate an API key without saving it."""
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
