"""
Bedrock model picker API (Settings > Bedrock models).

An administrator picks the Bedrock model behind each tier of
``shared.models`` (fast / balanced / deep), tests it (a live Converse call
plus the account's quota for it) and saves it; the runtime Lambdas then use
the saved model (``shared.models.saved_model``). Reached through the
config-mgmt router for ``/api/providers/bedrock``, reusing the providers
resources with ``{id} = bedrock``:

- GET  /api/providers/bedrock/models    the tiers and the models to choose from
- POST /api/providers/bedrock/validate  test a model for a tier without saving
- PUT  /api/providers/bedrock           save (re-tested) or reset a tier's model

Storage: one ProviderConfig row per tier (``bedrock-fast`` ...) holding
``model``, ``request_style``, ``model_updated_at``, ``updated_at`` and
``tested_at``, and the row ``bedrock-quotas`` holding the account's quotas as
read so far (see Quotas below). ``GET /api/providers`` only reads the rows of
the providers it knows, so these rows never appear there.
"""

import logging
import re
import time
from collections.abc import Mapping
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, NamedTuple

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, ReadTimeoutError

from shared.api_response import api_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, get_caller_identity, require_group
from shared.decorators import RouteNotHandledError, api_handler, cors_preflight, parse_json_body, route_handler
from shared.env_vars import resolve_table_env
from shared.log_safety import log_text
from shared.models import (
    ModelTier,
    RequestStyle,
    build_converse_request,
    default_model,
    first_guess_style,
    is_allowed_model_id,
    model_family,
    roles_for_tier,
    saved_model_from_row,
    style_correction,
    tier_provider_id,
)
from shared.utils import get_timestamp, parse_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

PROVIDER_CONFIG_TABLE = resolve_table_env('DYNAMODB_TABLE_PROVIDER_CONFIG')
BEDROCK_PROVIDER_ID = 'bedrock'

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock')

# POST /validate (and PUT, which re-tests first) must answer inside API
# Gateway's 29 s. Worst case, every timeout hit:
#   quota slice    pages start during the first 5 s; the last may overrun by
#                  one page: 2 attempts x (1 s connect + 3 s read) + <= 1 s
#                  backoff = 9 s                                       <= 14 s
#   first answer   one attempt: 3 s connect + 8 s read                 <= 25 s
#   second style   only after a refusal, and only when one more attempt
#                  (11 s) still ends by the 25 s deadline               <= 25 s
# which leaves 4 s for Lambda start-up, the quota row's read and write and API
# Gateway. Measured: a page answers in 0.4-1 s, a refusal in well under 1 s.
VALIDATE_DEADLINE_SECONDS = 25.0
_CONVERSE_CONNECT_SECONDS = 3
_CONVERSE_READ_SECONDS = 8
CONVERSE_ATTEMPT_SECONDS = float(_CONVERSE_CONNECT_SECONDS + _CONVERSE_READ_SECONDS)

# ListServiceQuotas is rate limited per account: a throttled or slow page ends
# the slice (progress is saved) instead of waiting it out.
service_quotas = boto3.client(
    'service-quotas',
    config=Config(connect_timeout=1, read_timeout=3, retries={'mode': 'standard', 'max_attempts': 2}),
)
# The model test reports throttling instead of riding it out.
bedrock_runtime = boto3.client(
    'bedrock-runtime',
    config=Config(
        connect_timeout=_CONVERSE_CONNECT_SECONDS, read_timeout=_CONVERSE_READ_SECONDS, retries={'max_attempts': 1},
    ),
)

# --- Test outcomes -----------------------------------------------------------

NOT_SUBSCRIBED = 'not_subscribed'
ACCESS_DENIED = 'access_denied'
NO_CAPACITY = 'no_capacity'
THROTTLED = 'throttled'
UNSUPPORTED = 'unsupported'
UNAVAILABLE = 'unavailable'
ERROR = 'error'

_REASON_MESSAGES = {
    NOT_SUBSCRIBED: 'This account is not subscribed to the model in AWS Marketplace. '
                    'Request access in the Bedrock console, then test again.',
    NO_CAPACITY: "The account's quota for this model is 0 tokens per minute, so it can't be used yet. "
                 'Nothing to do but wait for the quota to be raised.',
    THROTTLED: "The model's capacity is exhausted right now. Try again in a minute.",
    UNSUPPORTED: 'The model accepts neither request style this system sends.',
    UNAVAILABLE: 'The model is not available (legacy or retired). Choose an active model.',
}
_RETENTION_REFUSAL = "data retention mode 'default' is not available"
_RETENTION_MESSAGE = "The model is not available with this account's data retention mode."
_UNREACHABLE_MESSAGE = 'Bedrock could not be reached. Try again.'
_SLOW_MESSAGE = f'The model took longer than {_CONVERSE_READ_SECONDS} s to answer; it may be busy right now. Try again.'

CHECK_PROMPT = 'Reply with the single word OK.'
CHECK_MAX_TOKENS = 64

_ARN = re.compile(r"arn:aws[a-z-]*:[^\s\"',)\]]*")
_ACCOUNT_ID = re.compile(r'\b\d{12}\b')
_MAX_ERROR_LENGTH = 300


def sanitize_aws_message(message: str) -> str:
    """``message`` without ARNs or account ids, on one line, at most 300 characters."""
    text = _ACCOUNT_ID.sub('<account>', _ARN.sub('<arn>', message))
    return ' '.join(text.split())[:_MAX_ERROR_LENGTH]


class Failure(NamedTuple):
    """Why a model test failed: one of the reasons above, and a message for the dashboard."""

    reason: str
    error: str


def _failure(reason: str) -> Failure:
    return Failure(reason, _REASON_MESSAGES[reason])


def _client_message(error: ClientError) -> str:
    return str(error.response.get('Error', {}).get('Message') or error)


def classify_failure(error: ClientError) -> Failure:
    """The reason a Converse ``ClientError`` gives for the model being unusable."""
    code = error.response.get('Error', {}).get('Code', '')
    message = _client_message(error)
    lowered = message.lower()
    if code == 'AccessDeniedException':
        if 'aws-marketplace' in lowered or 'not authorized to subscribe' in lowered:
            return _failure(NOT_SUBSCRIBED)
        return Failure(ACCESS_DENIED, f'Access to the model was denied: {sanitize_aws_message(message)}')
    if code in ('ThrottlingException', 'TooManyRequestsException') or 'too many requests' in lowered:
        return _failure(THROTTLED)
    if code == 'ResourceNotFoundException' or 'upgrade to an active model' in lowered:
        return _failure(UNAVAILABLE)
    if _RETENTION_REFUSAL in lowered:
        return Failure(UNSUPPORTED, _RETENTION_MESSAGE)
    return Failure(ERROR, sanitize_aws_message(message) or 'Model check failed')


# --- Quotas ------------------------------------------------------------------
#
# Service Quotas lists Bedrock's ~1,000 quotas a page at a time (about 40 per
# page with MaxResults=100), far too slow for one request behind API Gateway
# and rate limited per account. So the reading is spread over requests: each
# reads pages for a few seconds and stores the merged map and the NextToken in
# the ProviderConfig row ``bedrock-quotas``; a complete map is re-read daily
# (while the new cycle runs, the previous map still answers). Two containers
# advancing at once may read the same pages twice; the last write wins, which
# at worst repeats some pages.

QUOTA_ROW_ID = 'bedrock-quotas'
_QUOTA_PREFIX = 'Global cross-region model inference '
QUOTA_PAGE_SIZE = 100
QUOTA_REFRESH = timedelta(hours=24)
QUOTA_CACHE_SECONDS = 600.0
LIST_QUOTA_BUDGET_SECONDS = 6.0
CHECK_QUOTA_BUDGET_SECONDS = 5.0
_THROTTLED_CODES = frozenset({'TooManyRequestsException', 'ThrottlingException'})


class QuotaEntry(NamedTuple):
    """One stored quota: its Service Quotas code and value."""

    code: str
    value: int


class QuotaReading(NamedTuple):
    """The ``bedrock-quotas`` row: the quotas read so far and where the reading stands."""

    quotas: dict[str, QuotaEntry]
    #: Where the current cycle continues; ``None`` when no cycle is under way.
    next_token: str | None
    #: A cycle has read every page at least once, so a missing name means "no such quota".
    complete: bool
    completed_at: str | None

    def is_current(self, now: datetime) -> bool:
        """Complete, and completed less than a day ago: nothing to read."""
        completed = parse_timestamp(self.completed_at)
        return self.complete and completed is not None and now - completed < QUOTA_REFRESH


_quota_cache: dict[str, tuple[float, QuotaReading]] = {}


def _clock() -> float:
    """Monotonic seconds for the slice budget, the validate deadline and the cache (patched by tests)."""
    return time.monotonic()


def _stored_entry(entry: object) -> QuotaEntry | None:
    if not isinstance(entry, Mapping) or not isinstance(entry.get('value'), Decimal | int | float):
        return None
    return QuotaEntry(str(entry.get('code') or ''), int(entry['value']))


def reading_from_row(row: Mapping[str, Any]) -> QuotaReading:
    """The reading a ``bedrock-quotas`` row holds (DynamoDB numbers back to ``int``)."""
    stored = row.get('quotas')
    quotas: dict[str, QuotaEntry] = {}
    for name, entry in (stored.items() if isinstance(stored, Mapping) else ()):
        parsed = _stored_entry(entry)
        if parsed is not None:
            quotas[str(name)] = parsed
    token = row.get('next_token')
    completed_at = row.get('completed_at')
    return QuotaReading(
        quotas,
        token if isinstance(token, str) and token else None,
        row.get('complete') is True,
        completed_at if isinstance(completed_at, str) else None,
    )


def row_from_reading(reading: QuotaReading) -> dict[str, Any]:
    """The ``bedrock-quotas`` row for ``reading`` (numbers as ``Decimal``, absent token when the cycle is done)."""
    row: dict[str, Any] = {
        'provider_id': QUOTA_ROW_ID,
        'quotas': {name: {'code': entry.code, 'value': Decimal(entry.value)} for name, entry in reading.quotas.items()},
        'complete': reading.complete,
        'updated_at': get_timestamp(),
    }
    if reading.next_token:
        row['next_token'] = reading.next_token
    if reading.completed_at:
        row['completed_at'] = reading.completed_at
    return row


def _page_entries(page: Mapping[str, Any]) -> dict[str, QuotaEntry]:
    """The global cross-region quotas of one ``list_service_quotas`` page, by name."""
    entries: dict[str, QuotaEntry] = {}
    for quota in page.get('Quotas', []):
        name = quota.get('QuotaName', '')
        if name.startswith(_QUOTA_PREFIX) and isinstance(quota.get('Value'), int | float):
            entries[name] = QuotaEntry(str(quota.get('QuotaCode') or ''), int(quota['Value']))
    return entries


def _page_request(token: str | None) -> dict[str, Any]:
    request: dict[str, Any] = {'ServiceCode': 'bedrock', 'MaxResults': QUOTA_PAGE_SIZE}
    if token:
        request['NextToken'] = token
    return request


def _log_page_failure(error: BotoCoreError | ClientError) -> None:
    code = error.response.get('Error', {}).get('Code') if isinstance(error, ClientError) else None
    if code in _THROTTLED_CODES:
        logger.info('Service Quotas throttled the quota reading; the next request continues it')
    else:
        logger.warning('Could not list the Bedrock service quotas', exc_info=error)


def read_quota_pages(start: QuotaReading, budget_seconds: float) -> QuotaReading:
    """``start`` advanced page by page until the budget is spent, the list ends or Service Quotas refuses.

    Continues from ``start.next_token`` (the first page when there is none),
    keeping the quotas already read and overwriting them as pages arrive. The
    clock is checked between pages, so the last page may end past the budget.
    """
    deadline = _clock() + budget_seconds
    quotas = dict(start.quotas)
    token = start.next_token
    while True:
        try:
            page = service_quotas.list_service_quotas(**_page_request(token))
        except (BotoCoreError, ClientError) as exc:
            _log_page_failure(exc)
            break
        quotas.update(_page_entries(page))
        token = page.get('NextToken') or None
        if token is None:
            return QuotaReading(quotas, None, complete=True, completed_at=get_timestamp())
        if _clock() >= deadline:
            break
    return start._replace(quotas=quotas, next_token=token)


def _load_reading() -> QuotaReading | None:
    try:
        response = _table().get_item(Key={'provider_id': QUOTA_ROW_ID}, ConsistentRead=True)
    except (BotoCoreError, ClientError):
        logger.warning('Could not read the stored Bedrock quotas', exc_info=True)
        return None
    return reading_from_row(response.get('Item') or {})


def _store_reading(reading: QuotaReading) -> None:
    try:
        _table().put_item(Item=row_from_reading(reading))
    except (BotoCoreError, ClientError):
        # The pages just read are lost; the next request reads them again.
        logger.warning('Could not store the Bedrock quotas', exc_info=True)


def advance_quota_reading(budget_seconds: float) -> QuotaReading | None:
    """The stored quota reading, advanced by up to ``budget_seconds`` of pages and saved; ``None`` when unreadable.

    A complete reading less than a day old is returned as is (no Service
    Quotas call); otherwise the current cycle continues, or a new one starts.
    """
    reading = _load_reading()
    if reading is None or reading.is_current(utc_now()):
        return reading
    advanced = read_quota_pages(reading, budget_seconds)
    if advanced != reading:
        _store_reading(advanced)
    return advanced


def quota_reading(budget_seconds: float) -> QuotaReading | None:
    """The account's quota reading after advancing it by up to ``budget_seconds``.

    A current, complete reading is kept 10 minutes per container (no row read
    then); any other reading is advanced on every call, so the container never
    hides progress. When the row cannot be read the last reading seen stands in.
    """
    cached = _quota_cache.get(QUOTA_ROW_ID)
    if cached is not None and _clock() - cached[0] < QUOTA_CACHE_SECONDS and cached[1].is_current(utc_now()):
        return cached[1]
    reading = advance_quota_reading(budget_seconds)
    if reading is None:
        return cached[1] if cached is not None else None
    _quota_cache[QUOTA_ROW_ID] = (_clock(), reading)
    return reading


def quota_model_label(model_id: str) -> str:
    """The model as the quota names spell it: ``...claude-sonnet-5-5`` -> ``Claude Sonnet 5.5``."""
    words: list[str] = []
    for part in model_family(model_id).split('-'):
        if part.isdigit() and words and words[-1][-1].isdigit():
            words[-1] = f'{words[-1]}.{part}'
        else:
            words.append(part if part.isdigit() else part.capitalize())
    return ' '.join(['Claude', *words])


def _per_minute(quotas: Mapping[str, QuotaEntry], unit: str, label: str) -> int | None:
    """The ``unit`` per minute quota for ``label`` (some names carry a ``V1`` suffix)."""
    name = f'{_QUOTA_PREFIX}{unit} per minute for Anthropic {label}'
    entry = quotas.get(name, quotas.get(f'{name} V1'))
    return None if entry is None else entry.value


def model_quota(model_id: str, reading: QuotaReading | None) -> dict[str, int | bool | None]:
    """``model_id``'s tokens- and requests-per-minute quotas in ``reading`` (``None`` when not found).

    ``complete`` says whether a missing quota means "none" (the whole list was
    read at least once) or "not read yet".
    """
    quotas = reading.quotas if reading is not None else {}
    label = quota_model_label(model_id)
    return {
        'tokens_per_minute': _per_minute(quotas, 'tokens', label),
        'requests_per_minute': _per_minute(quotas, 'requests', label),
        'complete': reading is not None and reading.complete,
    }


# --- The model test ----------------------------------------------------------


class _Probe(NamedTuple):
    style: RequestStyle | None
    latency_ms: int | None
    failure: Failure | None


_OUT_OF_TIME_MESSAGE = 'The test ran out of time before it could try the second request style. Test again.'


def _probe(tier: ModelTier, model: str, deadline: float) -> _Probe:
    """One short answer from ``model``: adaptive first, budget when adaptive is refused.

    The budget attempt is only made when it can end by ``deadline``.
    """
    for style in (RequestStyle.ADAPTIVE, RequestStyle.BUDGET):
        if style is RequestStyle.BUDGET and _clock() + CONVERSE_ATTEMPT_SECONDS > deadline:
            return _Probe(None, None, Failure(ERROR, _OUT_OF_TIME_MESSAGE))
        request = build_converse_request(
            model, style, tier, CHECK_PROMPT, max_tokens=CHECK_MAX_TOKENS, thinking=False,
        )
        started = time.perf_counter()
        try:
            bedrock_runtime.converse(**request)
        except ClientError as exc:
            if style_correction(_client_message(exc), style) is None:
                return _Probe(None, None, classify_failure(exc))
        except ReadTimeoutError:
            # A slow answer, not an outage: Opus under load can take longer than the read timeout.
            logger.warning('Bedrock model check timed out waiting for %s', model)
            return _Probe(None, None, Failure(ERROR, _SLOW_MESSAGE))
        except BotoCoreError:
            logger.warning('Bedrock model check could not reach Bedrock', exc_info=True)
            return _Probe(None, None, Failure(ERROR, _UNREACHABLE_MESSAGE))
        else:
            return _Probe(style, round((time.perf_counter() - started) * 1000), None)
    return _Probe(None, None, _failure(UNSUPPORTED))


def check_model(tier: ModelTier, model: str) -> dict[str, Any]:
    """Test ``model`` for ``tier``: the quota first (0 tokens/min skips the call), then a live answer."""
    deadline = _clock() + VALIDATE_DEADLINE_SECONDS
    quota = model_quota(model, quota_reading(CHECK_QUOTA_BUDGET_SECONDS))
    if quota['tokens_per_minute'] == 0:
        probe = _Probe(None, None, _failure(NO_CAPACITY))
    else:
        probe = _probe(tier, model, deadline)
    return {
        'valid': probe.failure is None,
        'model': model,
        'request_style': probe.style.value if probe.style else None,
        'latency_ms': probe.latency_ms,
        'quota': quota,
        'reason': probe.failure.reason if probe.failure else None,
        'error': probe.failure.error if probe.failure else None,
    }


# --- Listing -----------------------------------------------------------------

_NAME_PREFIX = re.compile(r'^global\s+', re.IGNORECASE)


def clean_profile_name(name: str) -> str:
    """``GLOBAL Anthropic Claude Opus 4.5`` -> ``Claude Opus 4.5``."""
    return _NAME_PREFIX.sub('', name).replace('Anthropic ', '').strip()


def _listed_model(profile: Mapping[str, Any]) -> dict[str, str] | None:
    profile_id = profile.get('inferenceProfileId')
    if profile.get('status') != 'ACTIVE' or not is_allowed_model_id(profile_id):
        return None
    return {'id': str(profile_id), 'name': clean_profile_name(str(profile.get('inferenceProfileName') or profile_id))}


def list_bedrock_models() -> list[dict[str, str]]:
    """The active global Claude inference profiles, sorted by name."""
    models: list[dict[str, str]] = []
    pages = bedrock.get_paginator('list_inference_profiles').paginate(typeEquals='SYSTEM_DEFINED')
    for page in pages:
        models.extend(
            entry for entry in map(_listed_model, page.get('inferenceProfileSummaries', [])) if entry is not None
        )
    return sorted(models, key=lambda entry: (entry['name'], entry['id']))


# --- Tier rows ---------------------------------------------------------------


def _table() -> Any:
    return dynamodb.Table(PROVIDER_CONFIG_TABLE)


def _tier_row(tier: ModelTier) -> dict[str, Any]:
    response = _table().get_item(Key={'provider_id': tier_provider_id(tier)}, ConsistentRead=True)
    return response.get('Item') or {}


def tier_view(tier: ModelTier, row: Mapping[str, Any]) -> dict[str, Any]:
    """One tier as the dashboard shows it, from its ``bedrock-<tier>`` row."""
    saved = saved_model_from_row(row)
    model = saved.model if saved else default_model(tier)
    style = (saved.request_style if saved else None) or first_guess_style(model)
    return {
        'tier': tier.value,
        'model': model,
        'default_model': default_model(tier),
        'is_default': model == default_model(tier),
        'request_style': style.value,
        'model_updated_at': row.get('model_updated_at'),
        'tested_at': row.get('tested_at'),
        'roles': roles_for_tier(tier),
    }


def _model_update(model: str | None, check: Mapping[str, Any] | None) -> tuple[str, dict[str, Any]]:
    """``UpdateExpression`` and values for saving ``model`` (``None``: back to the default)."""
    timestamp = get_timestamp()
    values: dict[str, Any] = {':ts': timestamp}
    if model is None:
        return 'SET model_updated_at = :ts, updated_at = :ts REMOVE model, request_style, tested_at', values
    values[':model'] = model
    if check is None:
        # Saved untested: the runtime starts from its first guess and corrects itself.
        return 'SET model = :model, model_updated_at = :ts, updated_at = :ts REMOVE request_style, tested_at', values
    values[':style'] = check['request_style']
    return (
        'SET model = :model, request_style = :style, model_updated_at = :ts, updated_at = :ts, tested_at = :ts',
        values,
    )


def save_tier_model(tier: ModelTier, model: str | None, check: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Store ``tier``'s model; the updated row, or ``None`` when the write failed."""
    expression, values = _model_update(model, check)
    try:
        response = _table().update_item(
            Key={'provider_id': tier_provider_id(tier)},
            UpdateExpression=expression,
            ExpressionAttributeValues=values,
            ReturnValues='ALL_NEW',
        )
    except (BotoCoreError, ClientError):
        logger.exception('Error saving the Bedrock model')
        return None
    return response.get('Attributes') or {}


# --- Request parsing ---------------------------------------------------------


def _requested_tier(body: Mapping[str, Any]) -> ModelTier | None:
    value = body.get('tier')
    return ModelTier(value) if value in {tier.value for tier in ModelTier} else None


def _tier_error(event: dict) -> dict:
    return validation_error('tier must be one of fast, balanced, deep', event, 'tier')


def _model_error(event: dict) -> dict:
    return validation_error('model must be a global.anthropic.claude-* inference profile id', event, 'model')


def _requested_override(tier: ModelTier, value: object) -> tuple[bool, str | None]:
    """``(well_formed, override)``: blank, ``null`` or the tier default mean "no override"."""
    model = value.strip() if isinstance(value, str) else value
    if model is None or model in ('', default_model(tier)):
        return True, None
    if is_allowed_model_id(model):
        return True, str(model)
    return False, None


def _unknown_provider(event: dict) -> dict | None:
    """The 404 for any ``{id}`` but ``bedrock``; ``None`` for ``bedrock``."""
    provider_id = (event.get('pathParameters') or {}).get('id')
    if provider_id == BEDROCK_PROVIDER_ID:
        return None
    return api_response(404, {'error': f'Provider {provider_id} not found'}, event)


# --- Routes ------------------------------------------------------------------


@require_group(ADMIN_GROUP)
def handle_list_models(event: dict, context: Any) -> dict:
    """GET /providers/bedrock/models - the three tiers and the models to choose from."""
    unknown = _unknown_provider(event)
    if unknown is not None:
        return unknown
    tiers = [tier_view(tier, _tier_row(tier)) for tier in ModelTier]
    try:
        models = list_bedrock_models()
    except (BotoCoreError, ClientError) as exc:
        logger.warning('Could not list Bedrock inference profiles', exc_info=True)
        details = sanitize_aws_message(_client_message(exc)) if isinstance(exc, ClientError) else _UNREACHABLE_MESSAGE
        return api_response(502, {'error': 'Could not list Bedrock models', 'details': details}, event)
    # The page load carries the quota reading forward, so the tests that follow find it further along.
    quota_reading(LIST_QUOTA_BUDGET_SECONDS)
    return success_response({'tiers': tiers, 'models': models}, event)


def _tier_and_model(event: dict, body: Mapping[str, Any], *, resettable: bool) -> tuple[ModelTier, str | None] | dict:
    """The requested tier and model, or the 404 / 400 to answer instead.

    ``resettable``: blank, ``null`` or the tier default mean "back to the
    default" (model ``None``); otherwise a model id is required.
    """
    unknown = _unknown_provider(event)
    if unknown is not None:
        return unknown
    tier = _requested_tier(body)
    if tier is None:
        return _tier_error(event)
    if resettable:
        well_formed, model = _requested_override(tier, body.get('model'))
    else:
        model = body.get('model')
        well_formed = is_allowed_model_id(model)
    if not well_formed:
        return _model_error(event)
    return tier, model


@require_group(ADMIN_GROUP)
@parse_json_body
def handle_validate(event: dict, context: Any, body: dict | None = None) -> dict:
    """POST /providers/bedrock/validate - test a model for a tier (always 200 once well formed)."""
    request = _tier_and_model(event, body or {}, resettable=False)
    if isinstance(request, dict):
        return request
    tier, model = request
    return success_response(check_model(tier, model or ''), event)


@require_group(ADMIN_GROUP)
@parse_json_body
def handle_save(event: dict, context: Any, body: dict | None = None) -> dict:
    """PUT /providers/bedrock - save a tier's model, re-tested first; the default (or null) resets it."""
    body = body or {}
    request = _tier_and_model(event, body, resettable=True)
    if isinstance(request, dict):
        return request
    tier, model = request
    check = None
    if model is not None and body.get('validate', True):
        check = check_model(tier, model)
        if not check['valid']:
            return api_response(400, {'error': 'Model check failed', 'details': check['error'], 'reason': check['reason']}, event)
    row = save_tier_model(tier, model, check)
    if row is None:
        return api_response(500, {'error': 'Failed to save model'}, event)
    logger.info(
        'Bedrock %s tier set to %s by %s', tier.value, log_text(model or 'the default'), log_text(get_caller_identity(event))
    )
    return success_response(tier_view(tier, row), event)


@api_handler
@cors_preflight
@route_handler({
    ('GET', '/models'): handle_list_models,
    ('POST', '/validate'): handle_validate,
    ('PUT', None): handle_save,
})
def handler(event: dict, context: Any) -> dict:
    """
    Bedrock model picker API Lambda Handler

    Endpoints:
    - GET /providers/bedrock/models - tiers and selectable models
    - POST /providers/bedrock/validate - test a model for a tier
    - PUT /providers/bedrock - save or reset a tier's model

    Routes handle everything; this body is never reached.
    """
    raise RouteNotHandledError(__name__)
