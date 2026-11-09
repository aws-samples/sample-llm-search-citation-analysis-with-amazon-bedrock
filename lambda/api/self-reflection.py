"""
Self-Reflection API

Triggers LLM self-reflection analysis for a keyword, brand, and persona.
The LLM explains why a brand was ranked in its position and provides
actionable content recommendations.

Endpoints:
- POST /self-reflection  - Trigger a new analysis (with 24h caching): 200 with
  the result when it needs no model call (cached, no data, brand absent);
  otherwise 202 ``{"status": "pending", keyword, brand, query_prompt_id}`` while
  an asynchronous invocation of this Lambda asks the model (B4: the call took
  15-60 s, past the gateway's 29 s)
- GET  /self-reflection   - Retrieve stored results; with ``brand`` and
  ``query_prompt_id`` also ``job`` (pending / failed / null when finished)
"""

import json
import logging
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from shared.answer_queries import query_latest_run_rows
from shared.api_response import api_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body, require_keyword, validate
from shared.llm_json import parse_llm_json
from shared.models import MODEL_TIMED_OUT_MESSAGE, BedrockDeadlineError, ModelRole, invoke_bedrock
from shared.request_deadline import current_deadline
from shared.scope_params import BRAND_FILTER_PARAMS, PERSONA_FILTER_PARAMS
from shared.search_results import search_results_table_name
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async
from shared.utils import brand_names_match, get_brand_config, get_timestamp, parse_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')

SEARCH_RESULTS_TABLE = search_results_table_name()
SELF_REFLECTION_TABLE = os.environ['DYNAMODB_TABLE_SELF_REFLECTION']
QUERY_PROMPTS_TABLE = os.environ['DYNAMODB_TABLE_QUERY_PROMPTS']
CACHE_TTL_HOURS = 24

# What the reflection prompt reads of each answer of the latest run.
_ANSWER_PROJECTION = 'keyword, #ts, provider, query_prompt_id, brands, #rs'
_ANSWER_NAMES = {'#ts': 'timestamp', '#rs': 'response'}

SELF_REFLECTION_PROMPT = """You are analysing an AI search response to explain brand ranking decisions.

Industry: {industry}
Keyword: {keyword}
Persona/Query: {persona_template}

Original AI Response:
{response_text}

Brand Extraction Data:
{brand_data_json}

Brand being analysed: {brand_name}
Current rank: {current_rank}
Brand classification: {classification}

Tracked brands configuration:
First-party: {first_party_brands}
Competitors: {competitor_brands}

Please provide a JSON response with this exact structure:
{{
  "explanation": "Why this brand was ranked at position {current_rank}...",
  "content_contributions": "What the brand's online content contributed to this ranking...",
  "competitor_advantages": "What competitor content showed that influenced their higher/lower rankings...",
  "missing_data_points": "What data or content was missing from this brand that would improve its ranking...",
  "recommendations": [
    {{
      "title": "Short action title",
      "description": "Detailed description of what to create or improve",
      "priority": "high|medium|low",
      "content_type": "landing page|blog post|FAQ section|data page|review page",
      "gap_reference": "The specific gap this addresses"
    }}
  ]
}}

Rank recommendations by estimated impact on improving the brand's position for this specific persona.
Be specific about what content changes would help. Reference concrete gaps you identified.
Return ONLY the JSON object. Do not include any text before or after the JSON."""


def get_persona_info(query_prompt_id: str) -> dict:
    """Look up persona name and template from the QueryPrompts table."""
    table = dynamodb.Table(QUERY_PROMPTS_TABLE)
    response = table.get_item(Key={'id': query_prompt_id})
    item = response.get('Item', {})
    return {
        'name': item.get('name', query_prompt_id),
        'template': item.get('template', ''),
    }


def _key_component(value: str) -> str:
    """Escape one composite-key component so the '#' delimiter stays unambiguous.

    Keywords, brands, and persona ids are user-supplied and may themselves
    contain '#' (bugs.md 2.3): without escaping, ("a#b", "c") and ("a", "b#c")
    build the same partition key, and begins_with("a#") also matches persona
    "a#b" — both cause cache collisions. Escaping '%' first keeps the encoding
    injective. Rows written under the old key format simply miss the cache and
    age out via the TTL.
    """
    return value.replace('%', '%25').replace('#', '%23')


def _reflection_pk(keyword: str, brand: str) -> str:
    """Build the keyword_brand partition key from escaped components."""
    return f"{_key_component(keyword)}#{_key_component(brand.lower())}"


def _persona_key_prefix(query_prompt_id: str) -> str:
    """Build the persona_timestamp sort-key prefix from the escaped persona id."""
    return f"{_key_component(query_prompt_id)}#"


# ---------------------------------------------------------------------------
# Analysis jobs (B4)
# ---------------------------------------------------------------------------
#
# The Bedrock call (Sonnet, medium thinking, 4000 tokens) takes 15-60 s, past
# API Gateway's 29 s. POST therefore claims a job marker and invokes this
# same Lambda asynchronously, answering 202; the asynchronous invocation runs
# the call under the Lambda's own time budget, stores the result as before
# (the 24 h cache row) and removes the marker. GET reports the marker while
# it exists. One marker per keyword, brand and persona: a second POST while
# one is pending starts nothing.

#: Sort-key suffix of the job marker; ``~`` sorts after every timestamp.
_JOB_MARKER = '~job'
JOB_PENDING = 'pending'
JOB_FAILED = 'failed'
#: A pending job older than this is reported failed and may be started again (the Lambda runs 60 s at most).
JOB_STALE_SECONDS = 300
#: How long a marker is kept (TTL); a failed one stays readable until then.
JOB_TTL_SECONDS = 3600
#: The key of the asynchronous event that runs a job instead of an API request.
JOB_EVENT_KEY = 'self_reflection_job'
_STALE_JOB_ERROR = 'The analysis did not finish; try again'


def _job_key(keyword: str, brand: str, query_prompt_id: str) -> dict[str, str]:
    return {
        'keyword_brand': _reflection_pk(keyword, brand),
        'persona_timestamp': f'{_persona_key_prefix(query_prompt_id)}{_JOB_MARKER}',
    }


def _is_job_marker(item: Mapping[str, Any]) -> bool:
    return 'job_status' in item


def _stale_before() -> str:
    return (utc_now() - timedelta(seconds=JOB_STALE_SECONDS)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def _claim_job(keyword: str, brand: str, query_prompt_id: str) -> bool:
    """Write a pending marker unless a fresh one exists; whether this request started the job."""
    table = dynamodb.Table(SELF_REFLECTION_TABLE)
    try:
        table.put_item(
            Item={
                **_job_key(keyword, brand, query_prompt_id),
                'job_status': JOB_PENDING,
                'started_at': get_timestamp(),
                'ttl': int(time.time()) + JOB_TTL_SECONDS,
            },
            ConditionExpression='attribute_not_exists(job_status) OR job_status <> :pending OR started_at < :stale',
            ExpressionAttributeValues={':pending': JOB_PENDING, ':stale': _stale_before()},
        )
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
            return False
        raise
    return True


def _fail_job(keyword: str, brand: str, query_prompt_id: str, message: str) -> None:
    dynamodb.Table(SELF_REFLECTION_TABLE).update_item(
        Key=_job_key(keyword, brand, query_prompt_id),
        UpdateExpression='SET job_status = :failed, #err = :message',
        ExpressionAttributeNames={'#err': 'error'},
        ExpressionAttributeValues={':failed': JOB_FAILED, ':message': message},
    )


def _clear_job(keyword: str, brand: str, query_prompt_id: str) -> None:
    dynamodb.Table(SELF_REFLECTION_TABLE).delete_item(Key=_job_key(keyword, brand, query_prompt_id))


def _job_view(marker: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """What GET says about the persona's job: ``None`` when there is none (finished or never started)."""
    if not marker:
        return None
    started_at = marker.get('started_at')
    view: dict[str, Any] = {'status': marker.get('job_status'), 'started_at': started_at}
    if view['status'] == JOB_PENDING and isinstance(started_at, str) and started_at < _stale_before():
        view['status'] = JOB_FAILED
        view['error'] = _STALE_JOB_ERROR
    elif view['status'] == JOB_FAILED:
        view['error'] = marker.get('error') or _STALE_JOB_ERROR
    return view


def check_cache(keyword: str, brand: str, query_prompt_id: str) -> dict[str, Any] | None:
    """Return a cached self-reflection result if one exists within the TTL window.

    The persona's job marker (``~job``) sorts after every timestamp, so the
    newest two rows are read and the marker skipped.
    """
    table = dynamodb.Table(SELF_REFLECTION_TABLE)
    response = table.query(
        KeyConditionExpression=(
            Key('keyword_brand').eq(_reflection_pk(keyword, brand)) &
            Key('persona_timestamp').begins_with(_persona_key_prefix(query_prompt_id))
        ),
        ScanIndexForward=False, Limit=2
    )
    items: list[dict[str, Any]] = [item for item in response.get('Items', []) if not _is_job_marker(item)]
    if not items:
        return None
    item = items[0]
    created_at = parse_timestamp(item.get('created_at'))
    if created_at is not None and utc_now() - created_at < timedelta(hours=CACHE_TTL_HOURS):
        return item
    return None


def fetch_search_data(keyword: str, query_prompt_id: str) -> tuple[str, list[dict[str, Any]]]:
    """The latest run's provider-tagged response texts and brand entries for a keyword + persona.

    ``('', [])`` when the keyword has no results, or none for that persona.
    """
    # Newest-first by sort key: a partition past one 1 MB page no longer
    # answers from its oldest runs.
    latest_items = query_latest_run_rows(
        dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, projection=_ANSWER_PROJECTION, attribute_names=_ANSWER_NAMES,
    )
    persona_items = [
        item for item in latest_items
        if query_prompt_id in (None, '', 'all') or item.get('query_prompt_id', 'default') == query_prompt_id
    ]

    response_texts: list[str] = []
    all_brands: list[dict[str, Any]] = []
    for item in persona_items[:4]:
        text = item.get('response', '')
        if text:
            response_texts.append(f"[{item.get('provider', 'unknown')}]: {text[:2000]}")
        all_brands.extend(item.get('brands', []))

    return '\n\n'.join(response_texts), all_brands


def find_brand_in_results(brand: str, brands_list: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, Any]:
    """Find a brand in the extracted brands list. Returns (brand_data, rank) or (None, None).

    Uses `brand_names_match` (normalized exact comparison), not substring
    matching. The substring form resurfaced here after four other files had
    already removed it (AUDIT-2026-08-19 §2.15): tracking `"Inn"` would return
    `"Holiday Inn"`'s rank, and that wrong rank is both fed to the Bedrock
    reflection prompt and persisted by `store_reflection` with a 24h TTL — so
    the model explains a competitor's position as if it were yours, and the
    dashboard shows it as fact.
    """
    if not brands_list:
        return None, None
    for b in brands_list:
        if brand_names_match(b.get('name', ''), brand):
            return b, b.get('rank', None)
    return None, None


def store_reflection(keyword, brand, query_prompt_id, persona_name,
                     reflection, config, current_rank):
    """Store a self-reflection result in DynamoDB with a 24-hour TTL."""
    table = dynamodb.Table(SELF_REFLECTION_TABLE)
    timestamp = get_timestamp()
    item = {
        'keyword_brand': _reflection_pk(keyword, brand),
        'persona_timestamp': f"{_persona_key_prefix(query_prompt_id)}{timestamp}",
        'keyword': keyword,
        'brand': brand,
        'query_prompt_id': query_prompt_id,
        'query_prompt_name': persona_name,
        'current_rank': current_rank,
        'explanation': reflection.get('explanation', ''),
        'content_contributions': reflection.get('content_contributions', ''),
        'competitor_advantages': reflection.get('competitor_advantages', ''),
        'missing_data_points': reflection.get('missing_data_points', ''),
        'recommendations': reflection.get('recommendations', []),
        'industry': config.get('industry', 'general'),
        'created_at': timestamp,
        'ttl': int(time.time()) + (CACHE_TTL_HOURS * 3600),
    }
    table.put_item(Item=item)
    return item


def strip_internal_keys(item: dict[str, Any]) -> dict[str, Any]:
    """Remove DynamoDB composite keys from the API response."""
    cleaned = dict(item)
    cleaned.pop('keyword_brand', None)
    cleaned.pop('persona_timestamp', None)
    return cleaned


# ---------------------------------------------------------------------------
# POST /self-reflection
# ---------------------------------------------------------------------------

@parse_json_body
@validate({
    'keyword': {'required': True, 'type': str, 'max_length': 500, 'source': 'body'},
    'brand': {'required': True, 'type': str, 'max_length': 200, 'source': 'body'},
    'query_prompt_id': {'required': False, 'type': str, 'max_length': 100, 'source': 'body'},
    'force_refresh': {'type': bool, 'default': False, 'source': 'body'},
})
def post_self_reflection(event, context, body, keyword, brand, query_prompt_id=None, force_refresh=False):
    """Trigger a self-reflection analysis for a keyword / brand / persona."""
    query_prompt_id = query_prompt_id or 'all'

    # 1. Check cache (skip if force_refresh)
    if not force_refresh:
        cached = check_cache(keyword, brand, query_prompt_id)
        if cached:
            logger.info("Returning cached self-reflection result")
            return success_response(strip_internal_keys(cached), event)

    # 2. Answer at once when no model is needed (no data, brand absent)
    prepared = _prepare_reflection(keyword, brand, query_prompt_id)
    if isinstance(prepared, _Answered):
        return success_response(prepared.result, event)

    # 3. Otherwise start the job (or join the one already running) and answer 202
    return _start_job(event, context, keyword, brand, query_prompt_id)


def _no_data_result(keyword: str, brand: str, query_prompt_id: str) -> dict[str, Any]:
    return {
        'keyword': keyword, 'brand': brand,
        'query_prompt_id': query_prompt_id, 'current_rank': None,
        'explanation': (
            f'No search results found for keyword "{keyword}" with the specified persona. '
            'Run an analysis first to generate data for self-reflection.'
        ),
        'content_contributions': '', 'competitor_advantages': '',
        'missing_data_points': '', 'recommendations': [],
    }


def _absence_result(keyword: str, brand: str) -> dict[str, Any]:
    return {
        'explanation': (
            f'The brand "{brand}" did not appear in any AI search results for '
            f'"{keyword}" under this persona. None of the queried AI engines '
            'mentioned or recommended this brand for the given query.'
        ),
        'content_contributions': 'No content from this brand was referenced by any AI engine.',
        'competitor_advantages': (
            'Competitor brands that did appear likely have stronger topical authority, '
            'more relevant content, or better structured data for this query.'
        ),
        'missing_data_points': (
            'The brand needs content that directly addresses this keyword and persona. '
            'Consider creating authoritative, well-structured pages targeting this topic.'
        ),
        'recommendations': [{
            'title': f'Create targeted content for "{keyword}"',
            'description': (
                f'Create a comprehensive page that directly addresses "{keyword}" '
                "from this persona's perspective to gain initial visibility."
            ),
            'priority': 'high',
            'content_type': 'landing page',
            'gap_reference': 'Brand completely absent from results',
        }],
    }


@dataclass(frozen=True)
class _Answered:
    """A reflection that needed no model: ``stored`` when it went into the cache (brand absent)."""

    result: dict[str, Any]
    stored: bool


@dataclass(frozen=True)
class _ReflectionPrompt:
    """Everything the model call and the stored row need."""

    prompt: str
    persona_name: str
    config: dict[str, Any]
    current_rank: Any


def _prepare_reflection(keyword: str, brand: str, query_prompt_id: str) -> _Answered | _ReflectionPrompt:
    """The answer that needs no model, or the prompt to send (the reads are bounded: one partition page, two get_items)."""
    response_text, brands_list = fetch_search_data(keyword, query_prompt_id)
    if not response_text:
        return _Answered(_no_data_result(keyword, brand, query_prompt_id), stored=False)

    brand_data, current_rank = find_brand_in_results(brand, brands_list)
    config = get_brand_config()
    persona_info = get_persona_info(query_prompt_id)
    if brand_data is None:
        stored = store_reflection(
            keyword, brand, query_prompt_id, persona_info['name'],
            _absence_result(keyword, brand), config, current_rank,
        )
        return _Answered(strip_internal_keys(stored), stored=True)

    tracked_brands = config.get('tracked_brands', {})
    prompt = SELF_REFLECTION_PROMPT.format(
        industry=config.get('industry', 'general'),
        keyword=keyword,
        persona_template=persona_info['template'] or persona_info['name'],
        response_text=response_text[:4000],
        brand_data_json=json.dumps(brands_list, default=str)[:2000],
        brand_name=brand,
        current_rank=current_rank or 'N/A',
        classification=brand_data.get('classification', 'other'),
        first_party_brands=', '.join(tracked_brands.get('first_party', [])),
        competitor_brands=', '.join(tracked_brands.get('competitors', [])),
    )
    return _ReflectionPrompt(prompt, persona_info['name'], config, current_rank)


def _own_function_name(context: Any) -> str:
    return getattr(context, 'function_name', None) or os.environ.get('AWS_LAMBDA_FUNCTION_NAME', '')


def _start_job(event: dict[str, Any], context: Any, keyword: str, brand: str, query_prompt_id: str) -> dict[str, Any]:
    """Claim the job and invoke this Lambda asynchronously to run it; 202, or 503 when it could not start."""
    job = {'keyword': keyword, 'brand': brand, 'query_prompt_id': query_prompt_id}
    if _claim_job(keyword, brand, query_prompt_id):
        try:
            invoke_self_async(
                _own_function_name(context),
                json.dumps({JOB_EVENT_KEY: job}).encode(),
                description='self-reflection analysis',
                lambda_client=lambda_client,
            )
        except SelfInvokeDispatchError:
            _fail_job(keyword, brand, query_prompt_id, 'Could not start the analysis; try again')
            return api_response(503, {'error': 'Could not start the analysis; try again'}, event)
    return success_response({'status': JOB_PENDING, **job}, event, status_code=202)


def run_reflection_job(job: object) -> dict[str, Any]:
    """The asynchronous half of POST: ask the model, store the reflection, remove the marker.

    Runs under the Lambda's own time budget (60 s, not the gateway's 29 s).
    Never raises: a failure is written to the marker for GET to report, and
    an asynchronous retry would spend a second Bedrock call.
    """
    if not isinstance(job, dict) or not all(isinstance(job.get(key), str) and job[key] for key in _JOB_FIELDS):
        logger.error('Ignoring a malformed self-reflection job')
        return {'status': 'ignored'}
    keyword, brand, query_prompt_id = (job[key][:limit] for key, limit in _JOB_FIELDS.items())
    try:
        outcome = _run_job(keyword, brand, query_prompt_id)
    except BedrockDeadlineError:
        logger.warning('Self-reflection model call ran out of time')
        outcome = MODEL_TIMED_OUT_MESSAGE
    except Exception:
        logger.exception('Self-reflection job failed')
        outcome = 'The analysis failed; try again'
    if outcome is None:
        _clear_job(keyword, brand, query_prompt_id)
        return {'status': 'done'}
    _fail_job(keyword, brand, query_prompt_id, outcome)
    return {'status': JOB_FAILED}


# The job fields and their length limits (the POST validation's).
_JOB_FIELDS = {'keyword': 500, 'brand': 200, 'query_prompt_id': 100}


def _run_job(keyword: str, brand: str, query_prompt_id: str) -> str | None:
    """Store the reflection; ``None`` when one was stored, else why the job ends without one."""
    prepared = _prepare_reflection(keyword, brand, query_prompt_id)
    if isinstance(prepared, _Answered):
        return None if prepared.stored else str(prepared.result['explanation'])
    raw_response = invoke_bedrock(
        prepared.prompt, ModelRole.ANALYSIS, max_tokens=4000, temperature=0, deadline=current_deadline(),
    )
    reflection = parse_llm_json(raw_response, expect="object") or {
        'explanation': raw_response, 'content_contributions': '',
        'competitor_advantages': '', 'missing_data_points': '',
        'recommendations': [],
    }
    store_reflection(
        keyword, brand, query_prompt_id, prepared.persona_name,
        reflection, prepared.config, prepared.current_rank,
    )
    return None


# ---------------------------------------------------------------------------
# GET /self-reflection
# ---------------------------------------------------------------------------

@validate({
    'keyword': require_keyword(),
    **BRAND_FILTER_PARAMS,
    **PERSONA_FILTER_PARAMS,
})
def get_self_reflection(event, context, keyword, brand=None, query_prompt_id=None):
    """Retrieve stored self-reflection results with optional filters.

    One page of rows (``truncated: true`` when more exist). With ``brand``
    and ``query_prompt_id`` the answer also carries ``job``: the persona's
    analysis while it runs (``{"status": "pending", "started_at"}``) or after
    it failed (``{"status": "failed", "error"}``); ``null`` once it finished,
    when ``results[0]`` is its reflection.
    """
    table = dynamodb.Table(SELF_REFLECTION_TABLE)

    if brand:
        key_cond = Key('keyword_brand').eq(_reflection_pk(keyword, brand))
        if query_prompt_id:
            key_cond = key_cond & Key('persona_timestamp').begins_with(_persona_key_prefix(query_prompt_id))
        response = table.query(KeyConditionExpression=key_cond, ScanIndexForward=False)
    else:
        response = table.scan(FilterExpression=Attr('keyword').eq(keyword))
    items: list[dict[str, Any]] = [item for item in response.get('Items', []) if not _is_job_marker(item)]
    if not brand:
        if query_prompt_id:
            items = [i for i in items if i.get('query_prompt_id') == query_prompt_id]
        items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

    body: dict[str, Any] = {'keyword': keyword, 'results': items, 'count': len(items)}
    if response.get('LastEvaluatedKey'):
        body['truncated'] = True
    if brand and query_prompt_id:
        marker = table.get_item(Key=_job_key(keyword, brand, query_prompt_id)).get('Item')
        body['job'] = _job_view(marker)
    return success_response(body, event)


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

_METHOD_HANDLERS: dict[str, Callable[..., dict[str, Any]]] = {
    'POST': post_self_reflection,
    'GET': get_self_reflection,
}


@api_handler
def handler(event, context):
    """
    POST /self-reflection  - Trigger a new analysis (200 with the result, or 202 while it runs)
    GET  /self-reflection   - Retrieve stored results (and the running job)
    ``{"self_reflection_job": {...}}`` - the asynchronous invocation POST starts
    """
    if JOB_EVENT_KEY in event:
        return run_reflection_job(event[JOB_EVENT_KEY])
    method_handler = _METHOD_HANDLERS.get(event.get('httpMethod', 'GET').upper())
    if method_handler is None:
        return validation_error('Method not allowed', event)
    return method_handler(event, context)
