"""
Lambda Handler Decorators

Provides reusable decorators to reduce boilerplate in API Lambda handlers.

Decorators:
- @api_handler: Wraps handler with try/except, logging, and error response
- @parse_json_body: Auto-parses JSON body and injects as 'body' kwarg
- @validate: Declarative input validation with field injection
- @route_handler: Routes requests by HTTP method to specific functions
- @cors_preflight: Handles OPTIONS requests for CORS automatically
- @paginate: Handles pagination params (limit, offset, sort_by, sort_order)

Wrapper contract: every decorator here wraps the handler as
``(event, context, *args, **kwargs)`` and forwards both ``*args`` and
``**kwargs`` untouched. Decorators only *add* to ``kwargs`` or short-circuit
with a response dict — they never consume a caller's positional arguments.

That uniformity is load-bearing, not cosmetic. Routers that pass a path
parameter positionally (``update_prompt(event, context, prompt_id)`` in
``manage-query-prompts.py``) compose with any subset of these decorators in any
order. When ``parse_json_body`` alone lacked ``*args``, stacking it under a
decorator that did forward them turned every ``PUT /api/query-prompts/{id}``
into a ``TypeError`` and a 500 — for administrators too, silently, because no
test exercised that composition. Keep new decorators to the same signature.

Usage:
    from shared.decorators import api_handler, parse_json_body, validate
    from shared.api_response import success_response

    @api_handler
    @parse_json_body
    @validate({
        'keyword': {'required': True, 'max_length': 500},
        'limit': {'type': int, 'min': 1, 'max': 100, 'default': 50}
    })
    def handler(event, context, body, keyword, limit):
        # Business logic only - no boilerplate needed
        return success_response({'keyword': keyword, 'limit': limit}, event)
"""

import json
import logging
from collections.abc import Callable
from functools import wraps
from typing import Any

from shared.api_response import error_response, validation_error
from shared.constants import MAX_KEYWORD_LENGTH
from shared.router import path_contains_segment

logger = logging.getLogger(__name__)

# The wrapper contract from the module docstring, named once so every
# decorator's ``wrapper`` reads the same way: an API Gateway proxy event in,
# a proxy response out.
ApiEvent = dict[str, Any]
ApiResponse = dict[str, Any]


def api_handler(func: Callable) -> Callable:
    """
    Decorator that wraps an API handler with standardized error handling.

    - Catches all exceptions
    - Logs errors with handler name and details
    - Returns sanitized error_response

    Usage:
        @api_handler
        def handler(event, context):
            # Your logic here - exceptions are caught automatically
            return success_response(data, event)
    """
    @wraps(func)
    def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
        try:
            return func(event, context, *args, **kwargs)
        except Exception as e:
            logger.error(f"Error in {func.__name__}: {e!s}", exc_info=True)
            return error_response(e, event)
    return wrapper


def parse_json_body(func: Callable) -> Callable:
    """
    Decorator that parses JSON body from event and injects as 'body' kwarg.

    - Handles missing body (defaults to {})
    - Returns validation_error on invalid JSON
    - Injects parsed body as keyword argument

    Usage:
        @api_handler
        @parse_json_body
        def handler(event, context, body):
            keyword = body.get('keyword')
            return success_response({'keyword': keyword}, event)
    """
    @wraps(func)
    def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
        try:
            body = json.loads(event.get('body') or '{}')
        except json.JSONDecodeError:
            return validation_error('Invalid JSON format', event)

        kwargs['body'] = body
        return func(event, context, *args, **kwargs)
    return wrapper


# =============================================================================
# Field validation helpers (used by @validate)
# =============================================================================

# Methods whose payload arrives in the request body. Every other method reads
# from the query string unless the schema entry names a ``source`` explicitly.
_BODY_METHODS = frozenset({'POST', 'PUT', 'PATCH'})


def _request_params(event: dict[str, Any], body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Group the request mappings a field may be read from, keyed by schema ``source`` name."""
    return {
        'body': body,
        'path': event.get('pathParameters') or {},
        'query': event.get('queryStringParameters') or {},
    }


def _field_source(rules: dict[str, Any], http_method: str) -> str:
    """An explicit ``source`` wins; otherwise writes read the body and everything else reads the query string."""
    source = rules.get('source')
    if source is not None:
        return source
    return 'body' if http_method in _BODY_METHODS else 'query'


def _raw_field_value(
    field_name: str,
    rules: dict[str, Any],
    request_params: dict[str, dict[str, Any]],
    http_method: str,
) -> Any:
    """Read a field's raw value from its source, falling back to the schema ``default`` when absent."""
    source = _field_source(rules, http_method)
    # Unrecognised source names fall back to the query string (long-standing behaviour).
    params = request_params.get(source, request_params['query'])
    value = params.get(field_name)
    if value is None and 'default' in rules:
        value = rules['default']
    return value


def _coerce(value: Any, expected_type: type) -> Any:
    """
    Convert a raw request value to ``expected_type``.

    Query-string values arrive as strings, so booleans accept ``true``/``1``/``yes``
    and lists split on commas. Raises ``ValueError`` or ``TypeError`` when the
    value cannot be converted; unknown types pass the value through unchanged.
    """
    if expected_type is int:
        return int(value)
    if expected_type is float:
        return float(value)
    if expected_type is bool:
        if isinstance(value, str):
            return value.lower() in ('true', '1', 'yes')
        return bool(value)
    if expected_type is str:
        return str(value).strip()
    if expected_type is list and isinstance(value, str):
        return [v.strip() for v in value.split(',')]
    return value


def _string_length_error(field_name: str, rules: dict[str, Any], value: Any) -> str | None:
    """Return the ``max_length``/``min_length`` violation for a string value, or ``None``."""
    if not isinstance(value, str):
        return None
    max_length = rules.get('max_length')
    if max_length and len(value) > max_length:
        return f"{field_name} too long (max {max_length} characters)"
    min_length = rules.get('min_length')
    if min_length and len(value) < min_length:
        return f"{field_name} too short (min {min_length} characters)"
    return None


def _numeric_range_error(field_name: str, rules: dict[str, Any], value: Any) -> str | None:
    """Return the ``min``/``max`` violation for a numeric value, or ``None``."""
    if not isinstance(value, (int, float)):
        return None
    min_val = rules.get('min')
    if min_val is not None and value < min_val:
        return f"{field_name} must be at least {min_val}"
    max_val = rules.get('max')
    if max_val is not None and value > max_val:
        return f"{field_name} must be at most {max_val}"
    return None


def _choices_error(field_name: str, rules: dict[str, Any], value: Any) -> str | None:
    """Return the ``choices`` violation, or ``None`` when the value is allowed (or no choices are set)."""
    choices = rules.get('choices')
    if choices and value not in choices:
        return f"Invalid {field_name}. Must be one of: {', '.join(str(c) for c in choices)}"
    return None


def _validated_field(field_name: str, rules: dict[str, Any], value: Any) -> tuple[Any, str | None]:
    """
    Coerce and validate one field against its schema entry.

    Returns ``(value, None)`` when every rule passes — ``value`` is the coerced
    result, or ``None`` for an absent optional field — and ``(value, message)``
    on the first rule that fails. Rules run in a fixed order: required, type,
    string length, numeric range, choices.
    """
    if value is None:
        if rules.get('required'):
            return None, f"Missing required field: {field_name}"
        return None, None

    expected_type = rules.get('type')
    if expected_type:
        try:
            value = _coerce(value, expected_type)
        except (ValueError, TypeError):
            return value, f"Invalid type for {field_name}: expected {expected_type.__name__}"

    error = (
        _string_length_error(field_name, rules, value)
        or _numeric_range_error(field_name, rules, value)
        or _choices_error(field_name, rules, value)
    )
    return value, error


def validate(schema: dict[str, dict[str, Any]]) -> Callable:
    """
    Decorator for declarative input validation.

    Validates fields from body (POST/PUT) or query params (GET) and injects
    validated values as keyword arguments to the handler.

    Schema format:
        {
            'field_name': {
                'required': bool,        # Field must be present (default: False)
                'type': type,            # Expected type: str, int, float, bool, list
                'max_length': int,       # Max string length
                'min_length': int,       # Min string length
                'min': number,           # Min numeric value
                'max': number,           # Max numeric value
                'choices': list,         # Allowed values
                'default': any,          # Default if not provided
                'source': str,           # 'body', 'query', or 'path' (auto-detected)
            }
        }

    Usage:
        @api_handler
        @parse_json_body
        @validate({
            'keyword': {'required': True, 'max_length': 500},
            'limit': {'type': int, 'min': 1, 'max': 100, 'default': 50},
            'status': {'choices': ['active', 'inactive'], 'default': 'active'}
        })
        def handler(event, context, body, keyword, limit, status):
            # All params are validated and injected
            return success_response({'keyword': keyword}, event)
    """
    def decorator(func: Callable) -> Callable[..., dict[str, Any]]:
        @wraps(func)
        def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
            request_params = _request_params(event, kwargs.get('body', {}))
            http_method = event.get('httpMethod', 'GET').upper()

            # Fields are validated in schema order; the first failure wins.
            for field_name, rules in schema.items():
                raw_value = _raw_field_value(field_name, rules, request_params, http_method)
                value, error = _validated_field(field_name, rules, raw_value)
                if error is not None:
                    return validation_error(error, event, field_name)
                kwargs[field_name] = value

            return func(event, context, *args, **kwargs)
        return wrapper
    return decorator


# Convenience aliases for common validation patterns
def require_keyword(max_length: int = MAX_KEYWORD_LENGTH) -> dict[str, Any]:
    """Common validation for keyword parameter."""
    return {'required': True, 'type': str, 'max_length': max_length}


def optional_limit(default: int = 50, max_val: int = 1000) -> dict[str, Any]:
    """Common validation for limit parameter."""
    return {'type': int, 'min': 1, 'max': max_val, 'default': default}


def optional_provider() -> dict[str, Any]:
    """Common validation for provider parameter."""
    return {
        'type': str,
        'max_length': 50,
        'choices': ['openai', 'perplexity', 'gemini', 'claude']
    }


# =============================================================================
# Route Handler Decorator
# =============================================================================

def route_handler(routes: dict[str | tuple[str, str | None], Callable], inject_path_params: bool = False) -> Callable[[Callable], Callable[..., dict[str, Any]]]:
    """
    Decorator that routes requests by HTTP method to specific handler functions.

    Eliminates repetitive if/elif chains for multi-method endpoints.
    Supports path-based sub-routing with tuples. With
    ``inject_path_params=True``, API Gateway ``pathParameters`` are passed to
    the matched function as keyword arguments (e.g. ``{id}`` arrives as
    ``id=...``), so parametric routes no longer need hand-rolled routing
    (bugs.md 3.4). Opt-in because existing routed functions do not declare
    path-param kwargs.

    Routes format:
        {
            'GET': get_handler_func,
            'POST': post_handler_func,
            'DELETE': delete_handler_func,
            # Or with path matching:
            ('GET', '/ideas'): get_ideas_func,
            ('POST', '/generate'): generate_func,
        }

    Usage:
        @api_handler
        @route_handler({
            'GET': list_items,
            'POST': create_item,
            'DELETE': delete_item,
        })
        def handler(event, context):
            pass  # Never reached - routes handle everything

        # With path-based routing:
        @api_handler
        @route_handler({
            ('GET', '/ideas'): get_ideas,
            ('POST', '/generate'): generate_content,
            ('GET', '/history'): get_history,
            ('DELETE', None): delete_item,  # DELETE with path param
        })
        def handler(event, context):
            pass
    """
    def decorator(func: Callable) -> Callable[..., dict[str, Any]]:
        @wraps(func)
        def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
            method = event.get('httpMethod', 'GET').upper()
            path = event.get('path', '')

            if inject_path_params:
                kwargs.update(event.get('pathParameters') or {})

            # First try path-specific routes (tuple keys). Match semantics:
            #   - None → method-only match (used for fallbacks like DELETE
            #     on a parametric path)
            #   - Otherwise, require a segment-exact occurrence of
            #     route_path in the request path. See
            #     `shared.router.path_contains_segment` for the boundary
            #     contract and audit item 26.
            for route_key, handler_func in routes.items():
                if isinstance(route_key, tuple):
                    route_method, route_path = route_key
                    if method == route_method.upper() and (
                        route_path is None or path_contains_segment(route_path, path)
                    ):
                        return handler_func(event, context, *args, **kwargs)

            # Then try method-only routes (string keys)
            if method in routes:
                handler_func = routes[method]
                return handler_func(event, context, *args, **kwargs)

            # Method not allowed
            return validation_error(f'Method {method} not allowed', event)

        return wrapper
    return decorator


# =============================================================================
# CORS Options Decorator
# =============================================================================

def cors_preflight(func: Callable) -> Callable:
    """
    Decorator that handles CORS preflight (OPTIONS) requests automatically.

    Returns proper CORS headers for OPTIONS requests without executing
    the main handler logic. For other methods, passes through to handler.

    Usage:
        @api_handler
        @cors_preflight
        def handler(event, context):
            # This only runs for non-OPTIONS requests
            return success_response({'data': 'value'}, event)
    """
    @wraps(func)
    def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
        method = event.get('httpMethod', '').upper()

        if method == 'OPTIONS':
            from shared.api_response import get_cors_headers

            # Get request origin for CORS
            request_headers = event.get('headers') or {}
            request_origin = (
                request_headers.get('origin') or
                request_headers.get('Origin') or
                request_headers.get('ORIGIN')
            )

            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    **get_cors_headers(request_origin)
                },
                'body': ''
            }

        return func(event, context, *args, **kwargs)

    return wrapper


# =============================================================================
# Pagination Decorator
# =============================================================================

def paginate(
    default_limit: int = 50,
    max_limit: int = 1000,
    default_sort_field: str = 'created_at',
    default_sort_order: str = 'desc'
) -> Callable:
    """
    Decorator that handles common pagination parameters.

    Extracts and validates pagination params from query string and injects
    them as kwargs: limit, offset, sort_by, sort_order.

    Query params supported:
        - limit: Number of items to return (default: 50, max: 1000)
        - offset: Number of items to skip (default: 0)
        - sort_by: Field to sort by (default: 'created_at')
        - sort_order: 'asc' or 'desc' (default: 'desc')

    Usage:
        @api_handler
        @paginate(default_limit=20, max_limit=100)
        def handler(event, context, limit, offset, sort_by, sort_order):
            items = fetch_items()

            # Sort
            reverse = sort_order == 'desc'
            items.sort(key=lambda x: x.get(sort_by, ''), reverse=reverse)

            # Paginate
            paginated = items[offset:offset + limit]

            return success_response({
                'items': paginated,
                'total': len(items),
                'limit': limit,
                'offset': offset
            }, event)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(event: ApiEvent, context: Any, *args, **kwargs) -> ApiResponse:
            query_params = event.get('queryStringParameters') or {}

            # Parse limit
            try:
                limit = int(query_params.get('limit', default_limit))
                limit = max(1, min(limit, max_limit))  # Clamp to valid range
            except (ValueError, TypeError):
                limit = default_limit

            # Parse offset
            try:
                offset = int(query_params.get('offset', 0))
                offset = max(0, offset)  # Ensure non-negative
            except (ValueError, TypeError):
                offset = 0

            # Parse sort_by (with basic validation)
            sort_by = query_params.get('sort_by', default_sort_field)
            if not isinstance(sort_by, str) or len(sort_by) > 50:
                sort_by = default_sort_field
            # Sanitize: only allow alphanumeric and underscore
            sort_by = ''.join(c for c in sort_by if c.isalnum() or c == '_')
            if not sort_by:
                sort_by = default_sort_field

            # Parse sort_order
            sort_order = query_params.get('sort_order', default_sort_order).lower()
            if sort_order not in ('asc', 'desc'):
                sort_order = default_sort_order

            # Inject pagination params
            kwargs['limit'] = limit
            kwargs['offset'] = offset
            kwargs['sort_by'] = sort_by
            kwargs['sort_order'] = sort_order

            return func(event, context, *args, **kwargs)

        return wrapper
    return decorator
