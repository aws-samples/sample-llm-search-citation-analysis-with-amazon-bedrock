"""
Provider Configuration API
Manages AI provider settings: check status, enable/disable, update API keys
"""

import base64
import json
import logging
import os
import sys
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial, wraps
from typing import Any, NamedTuple

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.ai_clients import (
    ANTHROPIC_API_BASE,
    PERPLEXITY_AGENT_URL,
    PERPLEXITY_MODELS_URL,
    anthropic_headers,
    claude_web_search_payload,
    gemini_generate_url,
    gemini_grounded_payload,
    openai_web_search_payload,
    perplexity_agent_payload,
)
from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.config import enabled_without_config
from shared.dataforseo_client import BILLING_MESSAGE, DEFAULT_BASE_URL, response_error
from shared.decorators import RouteNotHandledError, api_handler, cors_preflight, parse_json_body, route_handler
from shared.dynamo_decimal import to_int
from shared.env_vars import resolve_table_env
from shared.provider_health import (
    INSUFFICIENT_CREDIT,
    classify_provider_error,
    record_provider_failure,
    record_provider_success,
)
from shared.provider_models import (
    CONFIGURABLE_MODEL_PROVIDERS,
    DEFAULT_PROVIDER_MODELS,
    current_model_id,
    default_model,
    effective_model,
    is_valid_model_id,
)
from shared.request_deadline import current_deadline
from shared.utils import get_timestamp
from shared.web_search_gateway import (
    WebSearchGatewayError,
    gateway_url,
    parse_search_reply,
    post_signed,
    search_payload,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

secrets_client = boto3.client('secretsmanager')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
PROVIDER_CONFIG_TABLE = resolve_table_env('DYNAMODB_TABLE_PROVIDER_CONFIG')
SECRETS_PREFIX = os.environ.get('SECRETS_PREFIX', 'citation-analysis/')

# Provider type constants
PROVIDER_TYPE_LLM = 'llm'
PROVIDER_TYPE_SEARCH = 'search'
# A credential for the SEO stack (DataForSEO): neither an answer engine nor a
# search provider, so no run calls it and nothing that counts engines or
# search providers counts it.
PROVIDER_TYPE_SEO = 'seo'

#: The DataForSEO login every DataForSEO-backed provider shares
#: (``citation-analysis/dataforseo-key`` = ``{"api_key": "<login>:<password>"}``).
DATAFORSEO = 'dataforseo'
DATAFORSEO_SECRET = f'{SECRETS_PREFIX}dataforseo-key'
DATAFORSEO_DOCS_URL = 'https://app.dataforseo.com/api-access'

# How a provider is authenticated: a key in Secrets Manager, or the Lambda's IAM role.
AUTH_API_KEY = 'api_key'
AUTH_IAM = 'iam'

# Provider definitions
PROVIDERS = {
    # LLM Providers (generate AI responses with citations)
    'openai': {
        'name': 'OpenAI',
        'description': 'Native web search via the Responses API',
        'secret_name': f'{SECRETS_PREFIX}openai-key',
        'docs_url': 'https://platform.openai.com/api-keys',
        'type': PROVIDER_TYPE_LLM
    },
    'perplexity': {
        'name': 'Perplexity',
        'description': 'Sonar model with real-time web search',
        'secret_name': f'{SECRETS_PREFIX}perplexity-key',
        'docs_url': 'https://www.perplexity.ai/settings/api',
        'type': PROVIDER_TYPE_LLM
    },
    'gemini': {
        'name': 'Google Gemini',
        'description': 'Google Search grounding',
        'secret_name': f'{SECRETS_PREFIX}gemini-key',
        'docs_url': 'https://aistudio.google.com/apikey',
        'type': PROVIDER_TYPE_LLM
    },
    'claude': {
        'name': 'Anthropic Claude',
        'description': 'Claude Sonnet with web search tool',
        'secret_name': f'{SECRETS_PREFIX}claude-key',
        'docs_url': 'https://console.anthropic.com/settings/keys',
        'type': PROVIDER_TYPE_LLM
    },
    # No key of its own: it reads the DataForSEO login (`credential_from`).
    'google_ai_overview': {
        'name': 'Google AI Overviews',
        'description': 'The AI Overview on a Google results page (via DataForSEO)',
        'secret_name': DATAFORSEO_SECRET,
        'credential_from': DATAFORSEO,
        'docs_url': DATAFORSEO_DOCS_URL,
        'model': 'google-serp',
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
    },
    # No secret: calls are signed with the Lambda role against the Web Search
    # gateway (lib/web-search-stack.ts), which is the provider's only credential.
    'agentcore': {
        'name': 'Amazon Bedrock Web Search',
        'description': 'Amazon-operated web index through an AgentCore Gateway (IAM, no API key)',
        'secret_name': None,
        'auth': AUTH_IAM,
        'docs_url': 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html',
        'model': 'web-search',
        'type': PROVIDER_TYPE_SEARCH
    },
    # The login + password the SEO stack and Google AI Overviews use; the
    # dashboard shows one input per `credential_fields` entry and sends
    # `api_key: "<login>:<password>"`. No model.
    DATAFORSEO: {
        'name': 'DataForSEO',
        'description': 'Keyword, SERP and AI Overview data for the SEO pages (login and API password)',
        'secret_name': DATAFORSEO_SECRET,
        'credential_fields': ['login', 'password'],
        'docs_url': DATAFORSEO_DOCS_URL,
        'type': PROVIDER_TYPE_SEO
    },
}

#: The optional fields of a ``PROVIDERS`` entry ``GET /providers`` passes through as they are.
_PASSTHROUGH_FIELDS = ('credential_from', 'credential_fields')

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


def _api_key_from(response: Mapping[str, Any]) -> str:
    """The ``api_key`` field of a ``GetSecretValue`` response ('' when absent)."""
    return json.loads(response['SecretString']).get('api_key', '') if 'SecretString' in response else ''


def mask_key(api_key: str) -> str:
    """The first and last four characters of a key, for display."""
    return api_key[:4] + '...' + api_key[-4:] if len(api_key) > 8 else '****'


def mask_login(api_key: str) -> str:
    """The login part of a ``login:password`` credential: the password is never shown, even in part."""
    return api_key.partition(':')[0] or '****'


def _secret_status(response: Mapping[str, Any], mask: Callable[[str], str] = mask_key) -> dict:
    """Status of a secret that exists: configured with a masked key, or present but empty."""
    api_key = _api_key_from(response)
    if not api_key:
        return {'exists': True, 'has_value': False, 'masked_key': None}
    created = response.get('CreatedDate')
    return {
        'exists': True,
        'has_value': True,
        'masked_key': mask(api_key),
        'last_updated': created.isoformat() if created else None,
    }


def get_secret_status(secret_name: str, mask: Callable[[str], str] = mask_key) -> dict:
    """Check if a secret exists and has a value."""
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
    except ClientError as e:
        if _error_code(e) == 'ResourceNotFoundException':
            return {'exists': False, 'has_value': False, 'masked_key': None}
        logger.exception("Error checking secret")
        return {'exists': False, 'has_value': False}
    return _secret_status(response, mask)


def uses_iam(provider_id: str) -> bool:
    """Whether ``provider_id`` is authenticated by IAM instead of a stored key."""
    return PROVIDERS.get(provider_id, {}).get('auth', AUTH_API_KEY) == AUTH_IAM


def uses_dataforseo_login(provider_id: str) -> bool:
    """Whether ``provider_id``'s credential is the DataForSEO ``login:password``."""
    return provider_id == DATAFORSEO or PROVIDERS.get(provider_id, {}).get('credential_from') == DATAFORSEO


def borrows_credential(provider_id: str) -> bool:
    """Whether ``provider_id`` reads another provider's key and so takes none of its own."""
    return bool(PROVIDERS.get(provider_id, {}).get('credential_from'))


def credential_status(provider_id: str) -> dict:
    """``get_secret_status`` for a key provider; for an IAM provider, whether its gateway is deployed.

    A DataForSEO credential is masked to its login.
    """
    if uses_iam(provider_id):
        return {'exists': True, 'has_value': gateway_url() is not None, 'masked_key': None}
    mask = mask_login if uses_dataforseo_login(provider_id) else mask_key
    return get_secret_status(PROVIDERS[provider_id]['secret_name'], mask)


def stored_api_key(secret_name: str) -> str:
    """The key currently stored in ``secret_name`` ('' when there is none).

    Read uncached, unlike ``shared.secrets.get_api_key``: an administrator who
    has just replaced a key must have the model check use the new one.
    """
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
    except ClientError as e:
        if _error_code(e) != 'ResourceNotFoundException':
            logger.exception("Error reading API key")
        return ''
    return _api_key_from(response)


def get_provider_config(provider_id: str) -> dict:
    """Get provider config from DynamoDB."""
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.get_item(Key={'provider_id': provider_id})
        return response.get('Item', {'provider_id': provider_id, 'enabled': enabled_without_config(provider_id)})
    except Exception:
        logger.exception("Error getting provider config")
        return {'provider_id': provider_id, 'enabled': enabled_without_config(provider_id)}


def _enabled_update(provider_id: str, enabled: bool) -> dict[str, Any]:
    """``update_item`` arguments that set ``enabled`` and leave every other attribute alone.

    The row is shared: the search Lambda records health on it
    (``shared/provider_health.py``) and it carries any configured model. A
    ``put_item`` here used to replace the whole row, so every toggle in
    Settings silently erased the failure streak, the auto-disable record and
    the last error.

    Switching a provider *on* is the administrator's "I fixed it" decision
    that ``record_provider_success`` deliberately leaves to them, so it also
    clears the auto-disable record and restarts the failure streak — otherwise
    the very next terminal failure would push the retained count past the
    threshold and switch the provider straight back off. ``last_error`` stays
    until a successful call clears it: it is still the truth about the last
    call that was made.
    """
    values: dict[str, Any] = {':enabled': enabled, ':ts': get_timestamp()}
    expression = 'SET enabled = :enabled, updated_at = :ts'
    if enabled:
        values[':zero'] = 0
        expression += ', consecutive_failures = :zero REMOVE auto_disabled, disabled_reason, disabled_at'
    return {
        'Key': {'provider_id': provider_id},
        'UpdateExpression': expression,
        'ExpressionAttributeValues': values,
    }


def save_provider_enabled(provider_id: str, enabled: bool) -> bool:
    """Persist a provider's enabled flag without touching the rest of its row."""
    try:
        dynamodb.Table(PROVIDER_CONFIG_TABLE).update_item(**_enabled_update(provider_id, enabled))
    except Exception:
        logger.exception("Error saving provider config")
        return False
    return True


def save_provider_model(provider_id: str, model: str | None) -> bool:
    """Persist the administrator's model for ``provider_id``; ``None`` returns it to the default.

    Choosing the default removes the override instead of storing the id, so a
    future release that moves the default moves this provider with it.
    ``model_updated_at`` records when answers started coming from a new model.
    """
    timestamp = get_timestamp()
    if model:
        expression = 'SET model = :model, model_updated_at = :ts, updated_at = :ts'
        values: dict[str, Any] = {':model': model, ':ts': timestamp}
    else:
        expression = 'SET model_updated_at = :ts, updated_at = :ts REMOVE model'
        values = {':ts': timestamp}
    try:
        dynamodb.Table(PROVIDER_CONFIG_TABLE).update_item(
            Key={'provider_id': provider_id},
            UpdateExpression=expression,
            ExpressionAttributeValues=values,
        )
    except Exception:
        logger.exception("Error saving provider model")
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


def _perplexity_agent(api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """A POST of ``payload`` to Perplexity's Agent API."""
    return _post(PERPLEXITY_AGENT_URL, headers=_bearer_json_headers(api_key), json=payload)


def _claude_messages(api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    """A POST of ``payload`` to Anthropic's Messages API."""
    return _post(f'{ANTHROPIC_API_BASE}/messages', headers=anthropic_headers(api_key), json=payload)


# --- Reading a probe response ---------------------------------------------


def _auth_verdict(
    response: Any,
    *,
    rejected: str,
    describe_failure: Callable[[Any], str] | None = None,
) -> dict:
    """200 proves the key, 401/403 refute it (``rejected``); any other status is unexpected.

    ``describe_failure`` may name the unexpected failure from the response
    body; without it, or when it finds nothing, the status code is reported.
    """
    if response.status_code == 200:
        return {'valid': True}
    if response.status_code in (401, 403):
        return {'valid': False, 'error': rejected}
    detail = describe_failure(response) if describe_failure else ''
    return {'valid': False, 'error': detail or f'Unexpected status {response.status_code}'}


def _probe_result(response: Any) -> dict:
    """Interpret a 1-token probe request: 200 proves the key, 401/403 refute it."""
    return _auth_verdict(response, rejected='Invalid API key')


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
    """Interpret the Anthropic probe: a 400 on the probe model still proves auth passed.

    Except the credit-balance 400: Anthropic reports an exhausted balance as
    a 400 ``invalid_request_error``, and a key with no credit cannot answer a
    single run query, so it is refused with Anthropic's own words rather than
    saved as "accepted".
    """
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
    message = error.get('message')
    if isinstance(message, str) and classify_provider_error(message, response.status_code) == INSUFFICIENT_CREDIT:
        return {'valid': False, 'error': message[:300]}
    return {'valid': True, 'note': 'Key accepted (model validation skipped)'}


# --- The probe each provider answers ----------------------------------------

# Listing models or running a one-result search answers within a few seconds;
# the 1-token completion (Anthropic) and Firecrawl's search wait on a model
# and are given twice as long. Both bound the outbound call so a stalled
# provider cannot hold this Lambda for its full duration.
_LISTING_PROBE_TIMEOUT = 5
_COMPLETION_PROBE_TIMEOUT = 10
# Seconds of the request's time budget a provider call leaves for the answer.
_PROBE_MARGIN_SECONDS = 1.0
# The shortest timeout worth sending a provider call with.
_MIN_PROBE_SECONDS = 2.0
OUT_OF_TIME_MESSAGE = 'The check ran out of time before the provider answered. Try again.'


def _openai_request(api_key: str) -> dict[str, Any]:
    return _get('https://api.openai.com/v1/models', headers={'Authorization': f'Bearer {api_key}'})


def _perplexity_request(api_key: str) -> dict[str, Any]:
    # The Agent API model listing needs the key (401 without a valid one) and
    # costs nothing.
    return _get(PERPLEXITY_MODELS_URL, headers={'Authorization': f'Bearer {api_key}'})


def _gemini_request(api_key: str) -> dict[str, Any]:
    return _get(
        'https://generativelanguage.googleapis.com/v1beta/models',
        headers={'x-goog-api-key': api_key},
    )


def _claude_request(api_key: str) -> dict[str, Any]:
    # Anthropic /v1/messages returns 401 immediately on a bad key
    # without consuming meaningful quota for a 1-token request.
    return _claude_messages(api_key, {
        'model': 'claude-haiku-4-5',
        'max_tokens': 1,
        'messages': [{'role': 'user', 'content': 'ping'}],
    })


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


_DATAFORSEO_USER_DATA_PATH = '/v3/appendix/user_data'


def _dataforseo_request(api_key: str) -> dict[str, Any]:
    # The free account endpoint (`shared.dataforseo_client.account_summary`
    # reads it with the stored login); sent here with the candidate login so a
    # key is proven before it is saved. Costs nothing.
    token = base64.b64encode(api_key.encode('utf-8')).decode('ascii')
    return _get(
        f'{DEFAULT_BASE_URL}{_DATAFORSEO_USER_DATA_PATH}',
        headers={'Authorization': f'Basic {token}', 'Accept': 'application/json'},
    )


_DATAFORSEO_REJECTED = 'DataForSEO rejected the login or API password'


def _dataforseo_payload(response: Any) -> object:
    """The parsed JSON body of a probe reply, or ``None`` when it is not JSON."""
    try:
        return response.json()
    except ValueError:
        return None


def _dataforseo_result(response: Any) -> dict:
    """Interpret ``GET /v3/appendix/user_data`` with the client's status ladder (one classification).

    A 200 whose envelope and task are 20000 proves the login; ``AUTH_FAILED`` (HTTP 401/403, in-body
    40100/40104) is a rejected login; ``BILLING_ISSUE`` a depleted balance; anything else is unexpected.
    """
    error = response_error(response.status_code, _dataforseo_payload(response), _DATAFORSEO_USER_DATA_PATH)
    if error is None:
        return {'valid': True}
    if error.code == 'AUTH_FAILED':
        return {'valid': False, 'error': _DATAFORSEO_REJECTED}
    if error.code == 'BILLING_ISSUE':
        return {'valid': False, 'error': BILLING_MESSAGE}
    status = error.provider_status
    return {'valid': False, 'error': f'Unexpected DataForSEO status {status}' if status else 'Invalid response format'}


def dataforseo_format_error(api_key: str) -> str | None:
    """Why ``api_key`` is not ``login:password`` (a non-empty login without ``:``, a non-empty password), else ``None``."""
    login, separator, password = api_key.partition(':')
    if not separator or not login or not password:
        return 'Enter the DataForSEO login and API password as login:password'
    return None


@dataclass(frozen=True)
class _KeyProbe:
    """How one provider's key is validated: the request to send, and how to read the reply."""

    request: Callable[[str], dict[str, Any]]
    """``api_key`` → ``requests.request`` keyword arguments. Builders return
    arguments rather than sending, so ``_send`` owns the single
    ``requests`` import and the one timeout/error boundary."""
    interpret: Callable[[Any], dict]
    """HTTP response → ``{'valid': ..., ...}`` result."""
    timeout: int = _LISTING_PROBE_TIMEOUT
    """Seconds the probe may take before it is reported as timed out."""


_KEY_PROBES: dict[str, _KeyProbe] = {
    # LLM providers
    'openai': _KeyProbe(_openai_request, partial(_listing_result, key='data')),
    'perplexity': _KeyProbe(_perplexity_request, partial(_listing_result, key='data')),
    'gemini': _KeyProbe(_gemini_request, partial(_listing_result, key='models')),
    'claude': _KeyProbe(_claude_request, _claude_result, _COMPLETION_PROBE_TIMEOUT),
    # Search providers
    'brave': _KeyProbe(_brave_request, _status_result),
    'tavily': _KeyProbe(_tavily_request, _status_result),
    'exa': _KeyProbe(_exa_request, _status_result),
    'serpapi': _KeyProbe(_serpapi_request, _status_result),
    'firecrawl': _KeyProbe(_firecrawl_request, _probe_result, _COMPLETION_PROBE_TIMEOUT),
    # The DataForSEO login, and the engine that reads it
    DATAFORSEO: _KeyProbe(_dataforseo_request, _dataforseo_result),
    'google_ai_overview': _KeyProbe(_dataforseo_request, _dataforseo_result),
}


def _out_of_time() -> dict:
    return {'valid': False, 'error': OUT_OF_TIME_MESSAGE, 'out_of_time': True}


def _send(request: dict[str, Any], timeout: float, interpret: Callable[[Any], dict], label: str) -> dict:
    """Send one outbound provider request and read the reply; never raises.

    The single ``requests`` import and timeout/error boundary shared by the
    key probes, the model check and the model listing. The timeout is the
    call's own, or what the request's time budget has left when that is less
    (``requests`` times a socket read, and these replies are one small JSON
    body). A call the budget cut short, or had no room for, answers
    ``out_of_time: True``: it says nothing about the provider.
    """
    import requests

    budget = current_deadline().remaining() - _PROBE_MARGIN_SECONDS
    if budget < _MIN_PROBE_SECONDS:
        return _out_of_time()
    try:
        response = requests.request(timeout=min(timeout, budget), **request)
        return interpret(response)
    except requests.Timeout:
        if budget < timeout:
            return _out_of_time()
        return {'valid': False, 'error': 'Validation request timed out'}
    except Exception:
        logger.exception('Error during %s', label)
        return {'valid': False, 'error': 'Validation failed'}


def _gateway_check(url: str) -> dict:
    """One real one-result search through the Web Search gateway; never raises."""
    budget = current_deadline().remaining() - _PROBE_MARGIN_SECONDS
    if budget < _MIN_PROBE_SECONDS:
        return _out_of_time()
    try:
        response = post_signed(url, search_payload('test', 1), min(_COMPLETION_PROBE_TIMEOUT, int(budget)))
        response.raise_for_status()
        parse_search_reply(response.json())
    except (WebSearchGatewayError, ValueError) as error:
        return {'valid': False, 'error': str(error)}
    except Exception:
        logger.exception('Error during Web Search gateway check')
        return {'valid': False, 'error': 'Validation failed'}
    return {'valid': True}


def validate_api_key(provider_id: str, api_key: str) -> dict:
    """Validate API key by making a simple test request (for an IAM provider, ``api_key`` is its gateway URL)."""
    if uses_iam(provider_id):
        return _gateway_check(api_key)
    probe = _KEY_PROBES.get(provider_id)
    if probe is None:
        return {'valid': False, 'error': 'Unknown provider'}
    return _send(probe.request(api_key), probe.timeout, probe.interpret, f'API key validation for {provider_id}')


# --- Model selection ---------------------------------------------------------

# A real answer from the chosen model with the exact tool configuration runs
# send (no market): web search for OpenAI, Claude and Perplexity's Agent API,
# Google Search grounding for Gemini. That is the only
# reliable way to learn a model accepts it — a model without web-search
# support answers 400, and three terminal failures in a run would
# auto-disable the provider. A few seconds and a fraction of a cent.
_MODEL_CHECK_TIMEOUT = 20
_MODEL_CHECK_PROMPT = 'Reply with the single word OK.'
_MODEL_CHECK_MAX_TOKENS = 64


def _openai_model_check(api_key: str, model: str) -> dict[str, Any]:
    return _post(
        'https://api.openai.com/v1/responses',
        headers=_bearer_json_headers(api_key),
        json=openai_web_search_payload(_MODEL_CHECK_PROMPT, model),
    )


def _perplexity_model_check(api_key: str, model: str) -> dict[str, Any]:
    # A short reply keeps the check to a fraction of a cent.
    return _perplexity_agent(api_key, perplexity_agent_payload(_MODEL_CHECK_PROMPT, model, max_output_tokens=_MODEL_CHECK_MAX_TOKENS))


def _gemini_model_check(api_key: str, model: str) -> dict[str, Any]:
    return _post(
        gemini_generate_url(model),
        headers={'x-goog-api-key': api_key, 'Content-Type': 'application/json'},
        json=gemini_grounded_payload(_MODEL_CHECK_PROMPT),
    )


def _claude_model_check(api_key: str, model: str) -> dict[str, Any]:
    # A short reply keeps the check to a cent or so; the prompt needs no search.
    return _claude_messages(api_key, claude_web_search_payload(_MODEL_CHECK_PROMPT, model, max_tokens=_MODEL_CHECK_MAX_TOKENS))


def _claude_listing_request(api_key: str) -> dict[str, Any]:
    # One page holds every model (the list is well under 1,000 entries), newest first.
    return _get(f'{ANTHROPIC_API_BASE}/models', headers=anthropic_headers(api_key), params={'limit': 1000})


def _gemini_listing_request(api_key: str) -> dict[str, Any]:
    # One page holds every model (the list is well under 1,000 entries).
    request = _gemini_request(api_key)
    request['params'] = {'pageSize': 1000}
    return request


def _provider_error_message(response: Any) -> str:
    """The ``error.message`` OpenAI, Perplexity, Gemini and Anthropic put in a failed response ('' when absent)."""
    try:
        payload = response.json()
    except ValueError:
        return ''
    error = payload.get('error') if isinstance(payload, dict) else None
    message = error.get('message') if isinstance(error, dict) else None
    return message[:300] if isinstance(message, str) else ''


def _model_check_result(response: Any) -> dict:
    """Interpret the model check: 200 means the model answered with web search enabled."""
    return _auth_verdict(response, rejected='The stored API key was rejected', describe_failure=_provider_error_message)


# Listed ids that cannot answer a web-search prompt: audio, realtime, speech,
# image and legacy completions models, and the chat-completions-only search
# variants (embedding and moderation ids never start with `gpt-` / `o<digit>`).
# A heuristic for the picker only — anything typed is still proven by the
# model check before it is saved.
_OPENAI_EXCLUDED_MARKERS = ('audio', 'realtime', 'transcribe', 'tts', 'image', 'search', 'instruct')
_GEMINI_EXCLUDED_MARKERS = ('embedding', 'tts', 'image', 'live', 'audio')


def _is_openai_answer_model(model_id: str) -> bool:
    family = model_id.startswith('gpt-') or (len(model_id) > 1 and model_id[0] == 'o' and model_id[1].isdigit())
    return family and not any(marker in model_id for marker in _OPENAI_EXCLUDED_MARKERS)


def _created(entry: dict[str, Any]) -> int:
    """When OpenAI published a listed model (0 when unknown), for newest-first ordering."""
    created = entry.get('created')
    return created if isinstance(created, int) else 0


def _openai_model_ids(payload: Any) -> list[str]:
    """Answer-capable ids from ``GET /v1/models``, newest first."""
    entries = payload.get('data') if isinstance(payload, dict) else None
    models = [
        entry for entry in entries or []
        if isinstance(entry, dict) and is_valid_model_id(entry.get('id')) and _is_openai_answer_model(entry['id'])
    ]
    models.sort(key=lambda entry: (-_created(entry), entry['id']))
    return [entry['id'] for entry in models]


def _gemini_model_id(entry: Any) -> str | None:
    """The bare id of a ``models.list`` entry that can ``generateContent``, else ``None``."""
    if not isinstance(entry, dict) or 'generateContent' not in (entry.get('supportedGenerationMethods') or []):
        return None
    name = entry.get('name')
    if not isinstance(name, str):
        return None
    model_id = name.removeprefix('models/')
    if not model_id.startswith('gemini-') or any(marker in model_id for marker in _GEMINI_EXCLUDED_MARKERS):
        return None
    return model_id if is_valid_model_id(model_id) else None


def _gemini_model_ids(payload: Any) -> list[str]:
    """``generateContent``-capable Gemini ids from ``models.list``, in the API's order."""
    entries = payload.get('models') if isinstance(payload, dict) else None
    return [model_id for model_id in map(_gemini_model_id, entries or []) if model_id]


# Claude 3 models predate the current web search tool generation (the 3.x
# ids that support it are deprecated), so the picker offers Claude 4 and later.
# Older families (Claude 2, Instant) are retired and no longer listed.
_CLAUDE_EXCLUDED_PREFIX = 'claude-3'


def _claude_model_ids(payload: Any) -> list[str]:
    """Claude ids from ``GET /v1/models``, in the API's order (newest first)."""
    entries = payload.get('data') if isinstance(payload, dict) else None
    return [
        entry['id'] for entry in entries or []
        if isinstance(entry, dict) and is_valid_model_id(entry.get('id'))
        and entry['id'].startswith('claude-') and not entry['id'].startswith(_CLAUDE_EXCLUDED_PREFIX)
    ]


# Perplexity's own models (`perplexity/sonar`, ...) lead the picker; the
# third-party ids the Agent API also serves (`openai/gpt-6-luna`, ...) follow
# in the API's order.
_PERPLEXITY_OWN_PREFIX = 'perplexity/'


def _perplexity_model_ids(payload: Any) -> list[str]:
    """Agent API ids from ``GET /v1/models``, Perplexity's own first."""
    entries = payload.get('data') if isinstance(payload, dict) else None
    ids = [
        entry['id'] for entry in entries or []
        if isinstance(entry, dict) and is_valid_model_id(entry.get('id'), 'perplexity')
    ]
    return sorted(ids, key=lambda model_id: not model_id.startswith(_PERPLEXITY_OWN_PREFIX))


def _listing_models(response: Any, read_ids: Callable[[Any], list[str]]) -> dict:
    """Interpret a model listing: the usable ids, or the provider's reason for refusing."""
    if response.status_code != 200:
        return {'valid': False, 'error': _provider_error_message(response) or f'Unexpected status {response.status_code}'}
    try:
        payload = response.json()
    except ValueError:
        return {'valid': False, 'error': 'Invalid response format'}
    return {'valid': True, 'models': read_ids(payload)}


class _ModelSupport(NamedTuple):
    """How one configurable provider's models are checked and listed."""

    check: Callable[[str, str], dict[str, Any]]
    """``(api_key, model)`` → ``requests.request`` arguments for a real answer."""
    listing: Callable[[str], dict[str, Any]]
    """``api_key`` → ``requests.request`` arguments for the model listing."""
    read_ids: Callable[[Any], list[str]]
    """Listing payload → the ids worth offering in the picker."""


_MODEL_SUPPORT: dict[str, _ModelSupport] = {
    'openai': _ModelSupport(_openai_model_check, _openai_request, _openai_model_ids),
    'perplexity': _ModelSupport(_perplexity_model_check, _perplexity_request, _perplexity_model_ids),
    'gemini': _ModelSupport(_gemini_model_check, _gemini_listing_request, _gemini_model_ids),
    'claude': _ModelSupport(_claude_model_check, _claude_listing_request, _claude_model_ids),
}


def validate_model(provider_id: str, api_key: str, model: str) -> dict:
    """Prove ``model`` answers a web-search prompt for ``provider_id`` with ``api_key``, with the body runs send."""
    support = _MODEL_SUPPORT[provider_id]
    return _send(support.check(api_key, model), _MODEL_CHECK_TIMEOUT, _model_check_result, f'model check for {provider_id}')


def list_models(provider_id: str, api_key: str) -> dict:
    """The models ``api_key`` can use for ``provider_id``, filtered to answer-capable ones."""
    support = _MODEL_SUPPORT[provider_id]
    return _send(
        support.listing(api_key), _LISTING_PROBE_TIMEOUT,
        partial(_listing_models, read_ids=support.read_ids), f'model listing for {provider_id}',
    )


def _model_fields(provider_id: str, config: Mapping[str, Any]) -> dict[str, Any]:
    """The model a run will use, its default, and whether Settings may change it.

    LLM providers take their default from ``shared.provider_models``; search
    providers have no model, so their ``model`` is the static label in
    ``PROVIDERS`` they always carried.
    """
    if provider_id not in DEFAULT_PROVIDER_MODELS:
        # DataForSEO has no model at all (`None`).
        return {'model': PROVIDERS[provider_id].get('model'), 'model_configurable': False}
    fields: dict[str, Any] = {
        'model': effective_model(provider_id, config),
        'default_model': default_model(provider_id),
        'model_configurable': provider_id in CONFIGURABLE_MODEL_PROVIDERS,
    }
    if config.get('model_updated_at'):
        fields['model_updated_at'] = config['model_updated_at']
    return fields


def _provider_state(provider_id: str) -> tuple[dict, dict]:
    """``credential_status`` and ``get_provider_config`` of one provider (both fail soft)."""
    return credential_status(provider_id), get_provider_config(provider_id)


def handle_get_providers(event: dict, context: Any) -> dict:
    """GET /providers - Get all providers with their status and health.

    Health fields (``last_error*``, ``last_success_at``,
    ``consecutive_failures``, ``auto_disabled``, ``disabled_reason``) ride
    along whenever the provider row carries them; the ProviderHealthBanner and
    the Settings badges render exclusively from these fields.
    """
    providers = []

    # One worker per provider: each reads its secret and its row (C12: 18 serial calls before).
    with ThreadPoolExecutor(max_workers=len(PROVIDERS)) as pool:
        states = list(pool.map(_provider_state, PROVIDERS))

    for (provider_id, info), (secret_status, config) in zip(PROVIDERS.items(), states, strict=True):
        providers.append({
            'auth': info.get('auth', AUTH_API_KEY),
            'id': provider_id,
            'name': info['name'],
            'description': info['description'],
            **_model_fields(provider_id, config),
            'docs_url': info['docs_url'],
            'type': info.get('type', PROVIDER_TYPE_LLM),
            **{field: info[field] for field in _PASSTHROUGH_FIELDS if field in info},
            **_key_state_fields(provider_id, config, secret_status),
            'last_updated': secret_status.get('last_updated'),
            **provider_health_fields(config),
        })

    return success_response({'providers': providers}, event)


def _key_state_fields(provider_id: str, config: Mapping[str, Any], secret_status: Mapping[str, Any]) -> dict[str, Any]:
    """Whether the provider is on (as the search Lambda reads it), and whether (and with which masked key) its secret is set."""
    return {
        'enabled': bool(config.get('enabled', enabled_without_config(provider_id))),
        'configured': secret_status.get('has_value', False),
        'masked_key': secret_status.get('masked_key'),
    }


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


def _malformed_credential(provider_id: str, api_key: str, event: dict) -> dict | None:
    """The 400 for a DataForSEO credential that is not ``login:password``, else ``None``."""
    reason = dataforseo_format_error(api_key) if uses_dataforseo_login(provider_id) else None
    return validation_error(reason, event, 'api_key') if reason else None


def _key_refusal(provider_id: str) -> str | None:
    """Why ``provider_id`` takes no API key of its own (IAM, or another provider's key), else ``None``."""
    if uses_iam(provider_id):
        return 'This provider is authenticated by IAM and takes no API key'
    if borrows_credential(provider_id):
        source = PROVIDERS[PROVIDERS[provider_id]['credential_from']]['name']
        return f'This provider uses the {source} login; set it on {source}'
    return None


@dataclass
class _ProviderUpdate:
    """What one PUT /providers/{id} changes, read from the body before anything is proven or written."""

    provider_id: str
    validate: bool
    api_key: str | None = None
    """The new key to store, stripped."""
    enabled: bool | None = None
    set_model: bool = False
    model: str | None = None
    """The override to store when ``set_model``; ``None`` returns the provider to its default model."""
    proven: bool = False
    """A real call answered with the key, so the provider's health record gets a fresh success."""


def _parse_update(provider_id: str, body: dict, event: dict) -> _ProviderUpdate | dict:
    """The update ``body`` asks for, or the 400 for the first malformed field."""
    update = _ProviderUpdate(provider_id, validate=bool(body.get('validate', True)))
    if body.get('api_key'):
        refusal = _key_refusal(provider_id)
        if refusal:
            return validation_error(refusal, event, 'api_key')
        api_key = body['api_key'].strip()
        # Input validation - reasonable key length
        if len(api_key) > 500:
            return validation_error('API key too long', event)
        malformed = _malformed_credential(provider_id, api_key, event)
        if malformed:
            return malformed
        update.api_key = api_key
    if 'enabled' in body:
        update.enabled = bool(body['enabled'])
    if 'model' in body:
        if provider_id not in CONFIGURABLE_MODEL_PROVIDERS:
            return validation_error('The model of this provider cannot be changed', event, 'model')
        well_formed, model = _requested_model(provider_id, body['model'])
        if not well_formed:
            return validation_error(
                'Model ids contain only letters, digits, dots, dashes and underscores (100 characters at most)'
                + (', after a vendor prefix such as perplexity/' if provider_id == 'perplexity' else ''),
                event, 'model',
            )
        update.set_model, update.model = True, model
    return update


def _failed_check(check: Mapping[str, Any], error: str, event: dict) -> dict:
    """The answer to a proving call that did not pass: 503 when it ran out of time, else 400 with its reason."""
    if check.get('out_of_time'):
        return api_response(503, {'error': 'The check ran out of time; nothing was saved', 'details': check['error']}, event)
    return api_response(400, {'error': error, 'details': check['error']}, event)


def _prove_key(update: _ProviderUpdate, event: dict) -> dict | None:
    """Check the new key with the provider (skippable with ``validate: false``)."""
    if update.api_key is None:
        return None
    validation = validate_api_key(update.provider_id, update.api_key)
    return None if validation.get('valid') else _failed_check(validation, 'Invalid API key', event)


def _prove_enabled(update: _ProviderUpdate, event: dict) -> dict | None:
    """Prove the provider answers before it is switched on.

    Switching a provider on is the administrator saying "I fixed it", so it is
    proven first (skippable with ``validate: false``, like the key and the
    model): the probe either records a fresh success, which clears the old
    failure from the Settings card, or records the fresh failure and leaves
    the provider off. Before this, re-enabling kept showing the failure that
    caused the auto-disable, dated weeks back, with no way to tell whether the
    new credit or key had taken. A probe stopped by the request's time budget
    says nothing about the provider and records nothing. An SEO credential is
    never called by a run, so switching it on proves nothing.
    """
    if not update.enabled or PROVIDERS[update.provider_id].get('type') == PROVIDER_TYPE_SEO:
        return None
    api_key = update.api_key or _key_for_proof(update.provider_id, event, 'enabled', 'enabling this provider')
    if isinstance(api_key, dict):
        return api_key
    probe = _enable_probe(update.provider_id, api_key, get_provider_config(update.provider_id))
    if not probe.get('valid'):
        if not probe.get('out_of_time'):
            record_provider_failure(dynamodb.Table(PROVIDER_CONFIG_TABLE), update.provider_id, probe['error'])
        return _failed_check(probe, 'Provider check failed', event)
    update.proven = True
    return None


def _prove_model(update: _ProviderUpdate, event: dict) -> dict | None:
    """Prove a new model with a real web-search answer (skippable with ``validate: false``, like the key).

    The check was a real answer with the key, so the provider's health record
    then says so; without this a credit failure from weeks ago stayed on the
    card after the model was proven to work. Returning to the default needs no check.
    """
    if update.model is None:
        return None
    api_key = update.api_key or _key_for_proof(update.provider_id, event, 'model', 'choosing a model')
    if isinstance(api_key, dict):
        return api_key
    check = validate_model(update.provider_id, api_key, update.model)
    if not check.get('valid'):
        return _failed_check(check, 'Model check failed', event)
    update.proven = True
    return None


def _save_failure(error: str, saved: list[str], event: dict) -> dict:
    """The 500 for a failed write, naming what this request had already saved."""
    return api_response(500, {'error': error, **({'saved': saved} if saved else {})}, event)


def _save_update(update: _ProviderUpdate, event: dict) -> dict | None:
    """Write the proven update: key, then flag, then model; the 500 of the first write that fails."""
    saved: list[str] = []
    if update.api_key is not None:
        if not update_api_key(PROVIDERS[update.provider_id]['secret_name'], update.api_key).get('success'):
            return _save_failure('Failed to update API key', saved, event)
        saved.append('api_key')
    if update.enabled is not None:
        if not save_provider_enabled(update.provider_id, update.enabled):
            return _save_failure('Failed to save configuration', saved, event)
        saved.append('enabled')
    if update.set_model and not save_provider_model(update.provider_id, update.model):
        return _save_failure('Failed to save model', saved, event)
    if update.proven:
        record_provider_success(dynamodb.Table(PROVIDER_CONFIG_TABLE), update.provider_id)
    return None


def _requested_model(provider_id: str, value: object) -> tuple[bool, str | None]:
    """``(well_formed, override)`` for a requested ``value``.

    Blank, ``null`` or the provider's default itself mean "use the default"
    (override ``None``), and so does a retired id that is read as the default
    (``sonar`` for Perplexity); anything else must be a safe model id.
    """
    model = value.strip() if isinstance(value, str) else value
    if model is None or model == '':
        return True, None
    if not isinstance(model, str) or not is_valid_model_id(model, provider_id):
        return False, None
    model = current_model_id(provider_id, model)
    return True, None if model == default_model(provider_id) else model


def _key_for_proof(provider_id: str, event: dict, field: str, action: str) -> str | dict:
    """The stored key a proving call needs, or the 400 to answer when there is none.

    Every change that is proven with a real call (a model, enabling) reads the
    key the same way and refuses the same way without one.
    """
    if uses_iam(provider_id):
        url = gateway_url()
        if url is None:
            return validation_error(f'Deploy the Web Search gateway stack before {action}', event, field)
        return url
    api_key = stored_api_key(PROVIDERS[provider_id]['secret_name'])
    if not api_key:
        return validation_error(f'Configure an API key before {action}', event, field)
    return api_key


def _enable_probe(provider_id: str, api_key: str, config: dict) -> dict:
    """One real call proving the provider answers with the stored key.

    The AI engines run the model check, a one-line answer from the configured
    (or default) model. It is the only probe that surfaces an exhausted credit
    balance: Anthropic reports it as a 400 that the key probe reads as "key
    accepted". The search providers run the key probe, a one-result search.
    """
    if provider_id in CONFIGURABLE_MODEL_PROVIDERS:
        return validate_model(provider_id, api_key, effective_model(provider_id, config))
    return validate_api_key(provider_id, api_key)


@require_group(ADMIN_GROUP)
@parse_json_body
@_with_known_provider
def handle_update_provider(event: dict, context: Any, provider_id: str, body: dict | None = None) -> dict:
    """PUT /providers/{id} - Update provider configuration (enabled, API key, model).

    Admin-only: this route writes Secrets Manager, and `configMgmtFunction`'s
    role holds prefix-wide read *and* write over every `citation-analysis/*`
    secret. An unprivileged caller could redirect provider billing or capture
    every prompt the system sends (AUDIT-2026-08-19 §0.3).

    Every proving call runs before anything is written (C6): the key, then
    enabling and the model, both proven with the key being saved rather than
    the one it replaces. A key used to be stored before the enable probe, so a
    probe that failed or ran past the gateway's 29 s left the new key saved
    and the flag unchanged. Each call is bounded by the request's time budget
    (``_send``); one that runs out answers 503 and nothing is saved.
    """
    body = body or {}

    update = _parse_update(provider_id, body, event)
    if isinstance(update, dict):
        return update
    if update.validate:
        for prove in (_prove_key, _prove_enabled, _prove_model):
            error = prove(update, event)
            if error is not None:
                return error
    error = _save_update(update, event)
    if error is not None:
        return error

    # Return updated status
    secret_status = credential_status(provider_id)
    config = get_provider_config(provider_id)

    return success_response({
        'id': provider_id,
        **_key_state_fields(provider_id, config, secret_status),
        **_model_fields(provider_id, config),
    }, event)


@require_group(ADMIN_GROUP)
@_with_known_provider
def handle_list_models(event: dict, context: Any, provider_id: str) -> dict:
    """GET /providers/{id}/models - Models the stored key can use, for the Settings picker.

    Admin-only, like every route that spends the stored key. AI engines only;
    the list is filtered to models that can answer a prompt, and whatever is
    chosen is still proven by the model check on save.
    """
    if provider_id not in CONFIGURABLE_MODEL_PROVIDERS:
        return validation_error('The model of this provider cannot be changed', event, 'id')
    api_key = stored_api_key(PROVIDERS[provider_id]['secret_name'])
    if not api_key:
        return validation_error('Configure an API key before choosing a model', event, 'id')
    listing = list_models(provider_id, api_key)
    if not listing.get('valid'):
        return api_response(502, {'error': 'Could not list models', 'details': listing['error']}, event)
    return success_response({
        'id': provider_id,
        'models': listing['models'],
        **_model_fields(provider_id, get_provider_config(provider_id)),
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
    if uses_iam(provider_id):
        return validation_error('This provider is authenticated by IAM and takes no API key', event, 'api_key')
    if borrows_credential(provider_id):
        # No key of its own: prove the stored login it reads.
        api_key = _key_for_proof(provider_id, event, 'api_key', 'checking this provider')
        if isinstance(api_key, dict):
            return api_key
        return success_response(validate_api_key(provider_id, api_key), event)
    api_key = body.get('api_key', '').strip()
    if not api_key:
        return validation_error('API key required', event, 'api_key')
    malformed = _malformed_credential(provider_id, api_key, event)
    if malformed:
        return malformed

    result = validate_api_key(provider_id, api_key)
    return success_response(result, event)


@api_handler
@cors_preflight
@route_handler({
    ('GET', '/models'): handle_list_models,
    ('GET', '/providers'): handle_get_providers,
    ('PUT', None): handle_update_provider,
    ('POST', '/validate'): handle_validate_key,
})
def handler(event: dict, context: Any) -> dict:
    """
    Provider Configuration API Lambda Handler

    Endpoints:
    - GET /providers - List all providers with status
    - GET /providers/{id}/models - Models the stored key can use (the AI engines)
    - PUT /providers/{id} - Update provider config (enable/disable, API key, model)
    - POST /providers/{id}/validate - Validate API key without saving

    Routes handle everything; this body is never reached.
    """
    raise RouteNotHandledError(__name__)
