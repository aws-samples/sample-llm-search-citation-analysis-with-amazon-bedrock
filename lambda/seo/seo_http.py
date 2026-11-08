"""
Request plumbing the SEO API sub-handlers share (``lambda/seo/seo-*.py``).

* **Routing**: ``seo_route`` builds a sub-handler's Lambda ``handler`` from its
  routes (``@api_handler @cors_preflight @seo_errors @within_lambda_deadline @route_handler``).
* **Deadline**: every route runs under ``dataforseo_client.call_deadline`` of the
  Lambda's remaining time minus 2 s, so a paid call never outlives the invocation.
* **Markets**: ``market_id`` absent or ``global`` is the global market; any other
  id must be one of the configured markets (``shared.markets``), else 400.
  ``market_request`` also normalizes the keyword and resolves the DataForSEO
  codes, so a request is refused before any paid call.
* **Errors**: every refusal is ``{"error": str, "code": str}``. A
  ``DataForSeoError`` answers with the status of its code (``ERROR_STATUS``) and
  a fixed message (the provider's own text is logged, never returned); a market
  DataForSEO does not serve is 400 ``UNSUPPORTED_MARKET``; the 400 / 403 answers
  of ``@validate`` and ``@require_group`` gain ``VALIDATION_ERROR`` / ``FORBIDDEN``;
  ``validation_errors`` answers a sub-handler's own request errors as 400 on their field.
* **Request lists**: keyword texts and keyword ids, bounded and deduplicated
  (``body_list``).
* **Cache**: ``CachePolicy`` names a ``shared.seo_cache`` namespace, version and TTL.

Shipped next to the sub-handlers (the SEO router's asset), imported as ``seo_http``.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache, wraps
from typing import Any

import boto3

from shared.api_response import api_response
from shared.dataforseo_client import DataForSeoError, call_deadline
from shared.dataforseo_locations import MarketCodes, UnsupportedMarketError, market_codes
from shared.decorators import RouteNotHandledError, api_handler, cors_preflight, route_handler
from shared.env_vars import resolve_table_env
from shared.markets import GLOBAL_MARKET_ID, Market, load_markets, markets_by_id
from shared.seo_cache import get_cached, put_cached
from shared.string_lists import normalize_string_list
from shared.utils import normalize_keyword

logger = logging.getLogger(__name__)

#: HTTP status of each ``DataForSeoError.code``; an unknown code is a 502 ``INTERNAL_ERROR``.
ERROR_STATUS: dict[str, int] = {
    'NOT_CONFIGURED': 503,
    'AUTH_FAILED': 502,
    'RATE_LIMITED': 429,
    'UPSTREAM_UNAVAILABLE': 502,
    'BILLING_ISSUE': 502,
    'VALIDATION_ERROR': 400,
    'INTERNAL_ERROR': 502,
    # A billed call past the user's daily limit (``shared.seo_spend_limit``); nothing was sent.
    'DAILY_LIMIT': 429,
}

ERROR_MESSAGES: dict[str, str] = {
    'NOT_CONFIGURED': 'DataForSEO is not configured: add its login in Settings > AI Providers',
    'AUTH_FAILED': 'DataForSEO rejected the login',
    'RATE_LIMITED': 'DataForSEO rate limit reached, try again in a minute',
    'UPSTREAM_UNAVAILABLE': 'DataForSEO is unavailable, try again later',
    'BILLING_ISSUE': 'The DataForSEO account balance is too low',
    'VALIDATION_ERROR': 'DataForSEO rejected the request',
    'INTERNAL_ERROR': 'DataForSEO returned an unexpected error',
    'DAILY_LIMIT': ('You have reached today\'s limit of paid DataForSEO calls (an Admin sets it in Settings > '
                    'AI Providers > SEO data); it resets at midnight UTC'),
}

#: Codes added to the answers of the shared decorators that carry none.
_DEFAULT_CODES = {400: 'VALIDATION_ERROR', 403: 'FORBIDDEN'}

MAX_KEYWORD_CHARS = 200
MAX_KEYWORD_ID_CHARS = 64

#: ``@validate`` entries of the request fields several routes take.
KEYWORD_FIELD: dict[str, Any] = {'required': True, 'type': str, 'min_length': 1, 'max_length': MAX_KEYWORD_CHARS}
MARKET_ID_FIELD: dict[str, Any] = {'type': str, 'max_length': 32}

BRAND_CONFIG_TABLE_ENV = 'DYNAMODB_TABLE_BRAND_CONFIG'

#: Seconds of the Lambda's remaining time kept back from DataForSEO calls, so the answer and the cache
#: write still fit within API Gateway's 29 s limit after the last call returns.
DEADLINE_MARGIN_S = 2.0

Handler = Callable[..., dict[str, Any]]
ListParser = Callable[[object, str, int], tuple[list[str] | None, str | None]]


class UnknownMarketError(ValueError):
    """The request names a market that is not configured."""


class InvalidKeywordError(ValueError):
    """The keyword has no Unicode identity (``normalize_keyword`` is empty)."""


class RequestFieldError(ValueError):
    """A request that cannot be sent; ``field`` names the offending request field (``validation_errors`` → None)."""

    def __init__(self, message: str, field: str) -> None:
        super().__init__(message)
        self.field = field


def dynamodb_table(env_name: str) -> Any:
    """The DynamoDB table named by the required ``env_name`` variable."""
    return boto3.resource('dynamodb').Table(resolve_table_env(env_name))


@cache
def brand_config_table() -> Any:
    """``CitationAnalysis-BrandConfig`` (markets and brand config), opened once per container."""
    return dynamodb_table(BRAND_CONFIG_TABLE_ENV)


def brand_config() -> dict[str, Any]:
    """The tracked brand's configuration (BrandConfig ``default``); ``{}`` before one is saved."""
    return brand_config_table().get_item(Key={'config_id': 'default'}).get('Item') or {}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

def seo_error(status: int, code: str, message: str, event: dict[str, Any], field: str | None = None) -> dict[str, Any]:
    """An error answer ``{"error": str, "code": str}`` (plus ``field`` for a request field)."""
    body: dict[str, Any] = {'error': message, 'code': code}
    if field:
        body['field'] = field
    return api_response(status, body, event)


def dataforseo_error(error: DataForSeoError, event: dict[str, Any]) -> dict[str, Any]:
    """The answer to a failed DataForSEO call."""
    code = error.code if error.code in ERROR_STATUS else 'INTERNAL_ERROR'
    logger.warning(
        'DataForSEO call failed: code=%s provider_status=%s cost_usd=%s', code, error.provider_status, error.cost_usd,
    )
    return seo_error(ERROR_STATUS[code], code, ERROR_MESSAGES[code], event)


def with_error_code(response: dict[str, Any]) -> dict[str, Any]:
    """``response`` with the default ``code`` of its status added to a JSON error body that has none."""
    code = _DEFAULT_CODES.get(response.get('statusCode', 200))
    raw = response.get('body')
    if code is None or not isinstance(raw, str) or not raw:
        return response
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        return response
    if not isinstance(body, dict) or 'code' in body:
        return response
    return {**response, 'body': json.dumps({**body, 'code': code})}


def seo_errors(func: Handler) -> Handler:
    """Answer the SEO errors as ``{"error", "code"}``; sits between ``@cors_preflight`` and ``@route_handler``."""
    @wraps(func)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            response = func(event, context, *args, **kwargs)
        except DataForSeoError as error:
            return dataforseo_error(error, event)
        except UnsupportedMarketError:
            return seo_error(400, 'UNSUPPORTED_MARKET', 'DataForSEO does not serve this market', event, 'market_id')
        except UnknownMarketError:
            return seo_error(400, 'VALIDATION_ERROR', 'Unknown market_id', event, 'market_id')
        except InvalidKeywordError:
            return seo_error(400, 'VALIDATION_ERROR', 'keyword is not valid text', event, 'keyword')
        return with_error_code(response)

    return wrapper


def validation_errors(error_fields: Mapping[type[Exception], str | None]) -> Callable[[Handler], Handler]:
    """Answer each listed error as 400 ``VALIDATION_ERROR`` on its request field.

    ``error_fields`` maps an error type to the field it is about (checked in order); ``None`` takes the field from
    the error's own ``field`` attribute.
    """
    caught = tuple(error_fields)

    def decorator(func: Handler) -> Handler:
        @wraps(func)
        def wrapper(event: dict[str, Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
            try:
                return func(event, *args, **kwargs)
            except caught as error:
                field = next(name for kind, name in error_fields.items() if isinstance(error, kind))
                own_field = getattr(error, 'field', None) if field is None else field
                return seo_error(400, 'VALIDATION_ERROR', str(error), event, own_field)

        return wrapper

    return decorator


def seo_route(routes: dict[str | tuple[str, str | None], Handler]) -> Handler:
    """The Lambda ``handler`` of a sub-handler file serving ``routes`` (``route_handler`` keys)."""
    def seo_handler(_event: dict[str, Any], _context: Any) -> dict[str, Any]:
        """Never reached: ``route_handler`` answers every request."""
        raise RouteNotHandledError(__name__)

    return api_handler(cors_preflight(seo_errors(within_lambda_deadline(route_handler(routes)(seo_handler)))))


def deadline_seconds(context: Any) -> float | None:
    """The Lambda's remaining time minus ``DEADLINE_MARGIN_S``, or ``None`` without a Lambda context (tests)."""
    remaining_ms = getattr(context, 'get_remaining_time_in_millis', None)
    if not callable(remaining_ms):
        return None
    millis = remaining_ms()
    if not isinstance(millis, int | float) or isinstance(millis, bool):
        return None
    return millis / 1000 - DEADLINE_MARGIN_S


def within_lambda_deadline(func: Handler) -> Handler:
    """Run ``func`` under a ``call_deadline`` of the Lambda's remaining time, so no paid call outlives the invocation."""
    @wraps(func)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        seconds = deadline_seconds(context)
        if seconds is None:
            return func(event, context, *args, **kwargs)
        with call_deadline(seconds):
            return func(event, context, *args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Markets
# ---------------------------------------------------------------------------

def resolve_market(market_id: str | None) -> tuple[str, Market | None]:
    """``(market_id, market)``; the global market is ``('global', None)``. Raises ``UnknownMarketError``."""
    if not market_id or market_id == GLOBAL_MARKET_ID:
        return GLOBAL_MARKET_ID, None
    market = markets_by_id(load_markets(brand_config_table())).get(market_id)
    if market is None:
        raise UnknownMarketError(market_id)
    return market_id, market


@dataclass(frozen=True)
class MarketRequest:
    """A keyword request resolved to its DataForSEO market."""

    keyword: str
    """``normalize_keyword`` of the requested text (NFKC, trimmed and lower-cased)."""
    market_id: str
    codes: MarketCodes


def market_request(keyword: str, market_id: str | None) -> MarketRequest:
    """Normalize ``keyword`` and resolve ``market_id``; raises before any paid call when either is unusable."""
    normalized = normalize_keyword(keyword)
    if not normalized:
        raise InvalidKeywordError(keyword)
    resolved_id, market = resolve_market(market_id)
    return MarketRequest(keyword=normalized, market_id=resolved_id, codes=market_codes(market))


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CachePolicy:
    """One ``shared.seo_cache`` namespace: its version and how long an entry lives."""

    namespace: str
    version: int
    ttl_seconds: int

    def get(self, params: Mapping[str, Any]) -> Any | None:
        return get_cached(self.namespace, self.version, params)

    def put(self, params: Mapping[str, Any], payload: Any, ttl_seconds: int | None = None) -> None:
        """Store ``payload`` for the policy's TTL, or ``ttl_seconds`` when given (a shorter life for empty answers)."""
        put_cached(self.namespace, self.version, params, payload,
                   self.ttl_seconds if ttl_seconds is None else ttl_seconds)


# ---------------------------------------------------------------------------
# Request lists
# ---------------------------------------------------------------------------

def _keyword_entry(entry: str) -> str | None:
    text = entry.strip()
    if not text or len(text) > MAX_KEYWORD_CHARS:
        return None
    return normalize_keyword(text) or None


def _keyword_id_entry(entry: str) -> str | None:
    text = entry.strip()
    return text if text and len(text) <= MAX_KEYWORD_ID_CHARS else None


def _required_list(
    value: object, field: str, limit: int, normalize: Callable[[str], str | None], entry_error: str,
) -> tuple[list[str] | None, str | None]:
    entries, error = normalize_string_list(
        value,
        limit=limit,
        normalize=normalize,
        type_error=f'{field} must be an array of strings',
        limit_error=f'{field} accepts at most {limit} entries',
        entry_error=entry_error,
    )
    if error is None and not entries:
        return None, f'{field} must contain at least one entry'
    return entries, error


def keyword_list(value: object, field: str, limit: int) -> tuple[list[str] | None, str | None]:
    """1..``limit`` keyword texts, each 1..200 characters, normalized (``normalize_keyword``) and deduplicated."""
    return _required_list(
        value, field, limit, _keyword_entry, f'{field} entries must be keywords of 1 to {MAX_KEYWORD_CHARS} characters',
    )


def keyword_id_list(value: object, field: str, limit: int) -> tuple[list[str] | None, str | None]:
    """1..``limit`` keyword ids, trimmed and deduplicated."""
    return _required_list(
        value, field, limit, _keyword_id_entry, f'{field} entries must be ids of 1 to {MAX_KEYWORD_ID_CHARS} characters',
    )


def body_list(field: str, parse: ListParser, limit: int) -> Callable[[Handler], Handler]:
    """Validate the body list ``field`` with ``parse`` and inject the entries as the ``field`` keyword.

    Goes under ``@json_object_body``; a refused list answers 400 ``VALIDATION_ERROR`` on ``field``.
    """
    def decorator(func: Handler) -> Handler:
        @wraps(func)
        def wrapper(event: dict[str, Any], context: Any, *args: Any, body: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
            entries, error = parse(body.get(field), field, limit)
            if entries is None:
                return seo_error(400, 'VALIDATION_ERROR', error or f'{field} is invalid', event, field)
            return func(event, context, *args, body=body, **{**kwargs, field: entries})

        return wrapper

    return decorator
