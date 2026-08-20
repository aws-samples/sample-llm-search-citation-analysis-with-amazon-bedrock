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
    def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
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
    def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
        try:
            body = json.loads(event.get('body') or '{}')
        except json.JSONDecodeError:
            return validation_error('Invalid JSON format', event)

        kwargs['body'] = body
        return func(event, context, *args, **kwargs)
    return wrapper


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
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
            # Get data sources
            body = kwargs.get('body', {})
            query_params = event.get('queryStringParameters') or {}
            path_params = event.get('pathParameters') or {}
            http_method = event.get('httpMethod', 'GET').upper()

            # Validate each field
            for field_name, rules in schema.items():
                # Determine source (body for POST/PUT, query for GET)
                source = rules.get('source')
                if source is None:
                    if http_method in ('POST', 'PUT', 'PATCH'):
                        source = 'body'
                    else:
                        source = 'query'

                # Get value from appropriate source
                if source == 'body':
                    value = body.get(field_name)
                elif source == 'path':
                    value = path_params.get(field_name)
                else:  # query
                    value = query_params.get(field_name)

                # Apply default if value is None
                if value is None and 'default' in rules:
                    value = rules['default']

                # Check required
                if rules.get('required') and value is None:
                    return validation_error(
                        f"Missing required field: {field_name}",
                        event,
                        field_name
                    )

                # Skip further validation if value is None (optional field)
                if value is None:
                    kwargs[field_name] = None
                    continue

                # Type conversion and validation
                expected_type = rules.get('type')
                if expected_type:
                    try:
                        if expected_type is int:
                            value = int(value)
                        elif expected_type is float:
                            value = float(value)
                        elif expected_type is bool:
                            if isinstance(value, str):
                                value = value.lower() in ('true', '1', 'yes')
                            else:
                                value = bool(value)
                        elif expected_type is str:
                            value = str(value).strip()
                        elif expected_type is list and isinstance(value, str):
                            value = [v.strip() for v in value.split(',')]
                    except (ValueError, TypeError):
                        return validation_error(
                            f"Invalid type for {field_name}: expected {expected_type.__name__}",
                            event,
                            field_name
                        )

                # String length validation
                if isinstance(value, str):
                    max_length = rules.get('max_length')
                    if max_length and len(value) > max_length:
                        return validation_error(
                            f"{field_name} too long (max {max_length} characters)",
                            event,
                            field_name
                        )

                    min_length = rules.get('min_length')
                    if min_length and len(value) < min_length:
                        return validation_error(
                            f"{field_name} too short (min {min_length} characters)",
                            event,
                            field_name
                        )

                # Numeric range validation
                if isinstance(value, (int, float)):
                    min_val = rules.get('min')
                    if min_val is not None and value < min_val:
                        return validation_error(
                            f"{field_name} must be at least {min_val}",
                            event,
                            field_name
                        )

                    max_val = rules.get('max')
                    if max_val is not None and value > max_val:
                        return validation_error(
                            f"{field_name} must be at most {max_val}",
                            event,
                            field_name
                        )

                # Choices validation
                choices = rules.get('choices')
                if choices and value not in choices:
                    return validation_error(
                        f"Invalid {field_name}. Must be one of: {', '.join(str(c) for c in choices)}",
                        event,
                        field_name
                    )

                # Inject validated value
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

def route_handler(routes: dict[str, Callable], inject_path_params: bool = False) -> Callable:
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
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
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
    def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
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
        def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
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
