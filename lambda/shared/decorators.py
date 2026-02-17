"""
Lambda Handler Decorators

Provides reusable decorators to reduce boilerplate in API Lambda handlers.

Decorators:
- @api_handler: Wraps handler with try/except, logging, and error response
- @parse_json_body: Auto-parses JSON body and injects as 'body' kwarg
- @validate: Declarative input validation with field injection
- @route_handler: Routes requests by HTTP method to specific functions
- @require_config: Injects brand config as 'config' kwarg
- @with_dynamodb_table: Injects DynamoDB table as kwarg
- @cors_preflight: Handles OPTIONS requests for CORS automatically
- @paginate: Handles pagination params (limit, offset, sort_by, sort_order)
- @standard_list_handler: Combines @api_handler + @paginate for list endpoints

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
import os
from functools import wraps
from typing import Any, Callable, Dict, Optional, Type, Union

import boto3

from shared.api_response import error_response, validation_error

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
    def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
        try:
            return func(event, context, **kwargs)
        except Exception as e:
            logger.error(f"Error in {func.__name__}: {str(e)}", exc_info=True)
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
    def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
        try:
            body = json.loads(event.get('body') or '{}')
        except json.JSONDecodeError:
            return validation_error('Invalid JSON format', event)
        
        kwargs['body'] = body
        return func(event, context, **kwargs)
    return wrapper


def validate(schema: Dict[str, Dict[str, Any]]) -> Callable:
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
        def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
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
                        if expected_type == int:
                            value = int(value)
                        elif expected_type == float:
                            value = float(value)
                        elif expected_type == bool:
                            if isinstance(value, str):
                                value = value.lower() in ('true', '1', 'yes')
                            else:
                                value = bool(value)
                        elif expected_type == str:
                            value = str(value).strip()
                        elif expected_type == list:
                            if isinstance(value, str):
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
            
            return func(event, context, **kwargs)
        return wrapper
    return decorator


# Convenience aliases for common validation patterns
def require_keyword(max_length: int = 500) -> Dict[str, Any]:
    """Common validation for keyword parameter."""
    return {'required': True, 'type': str, 'max_length': max_length}


def optional_limit(default: int = 50, max_val: int = 1000) -> Dict[str, Any]:
    """Common validation for limit parameter."""
    return {'type': int, 'min': 1, 'max': max_val, 'default': default}


def optional_provider() -> Dict[str, Any]:
    """Common validation for provider parameter."""
    return {
        'type': str,
        'max_length': 50,
        'choices': ['openai', 'perplexity', 'gemini', 'claude']
    }


# =============================================================================
# Route Handler Decorator
# =============================================================================

def route_handler(routes: Dict[str, Callable]) -> Callable:
    """
    Decorator that routes requests by HTTP method to specific handler functions.
    
    Eliminates repetitive if/elif chains for multi-method endpoints.
    Supports path-based sub-routing with tuples.
    
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
        def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
            method = event.get('httpMethod', 'GET').upper()
            path = event.get('path', '')
            
            # First try path-specific routes (tuple keys)
            for route_key, handler_func in routes.items():
                if isinstance(route_key, tuple):
                    route_method, route_path = route_key
                    if method == route_method.upper():
                        if route_path is None or route_path in path:
                            return handler_func(event, context, **kwargs)
            
            # Then try method-only routes (string keys)
            if method in routes:
                handler_func = routes[method]
                return handler_func(event, context, **kwargs)
            
            # Method not allowed
            return validation_error(f'Method {method} not allowed', event)
        
        return wrapper
    return decorator


# =============================================================================
# Brand Config Decorator
# =============================================================================

# Cache for brand config to avoid repeated DynamoDB calls
_brand_config_cache: Dict[str, Any] = {}
_brand_config_cache_ttl = 60  # seconds
_brand_config_cache_time = 0


def require_config(func: Callable) -> Callable:
    """
    Decorator that injects brand configuration as 'config' kwarg.
    
    Fetches brand config from DynamoDB (with caching) and injects it
    into the handler function. Useful for handlers that need brand
    tracking configuration.
    
    Usage:
        @api_handler
        @require_config
        def handler(event, context, config):
            first_party = config.get('tracked_brands', {}).get('first_party', [])
            return success_response({'brands': first_party}, event)
    """
    @wraps(func)
    def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
        import time
        global _brand_config_cache, _brand_config_cache_time
        
        now = time.time()
        
        # Check cache
        if _brand_config_cache and (now - _brand_config_cache_time) < _brand_config_cache_ttl:
            kwargs['config'] = _brand_config_cache
        else:
            # Fetch from DynamoDB
            try:
                from shared.utils import get_brand_config
                config = get_brand_config()
                _brand_config_cache = config
                _brand_config_cache_time = now
                kwargs['config'] = config
            except Exception as e:
                logger.warning(f"Failed to get brand config: {e}")
                kwargs['config'] = {}
        
        return func(event, context, **kwargs)
    
    return wrapper


# =============================================================================
# DynamoDB Table Decorator
# =============================================================================

# Cache for DynamoDB table resources
_dynamodb_tables: Dict[str, Any] = {}
_dynamodb_resource = None


def with_dynamodb_table(env_var: str, kwarg_name: str = 'table') -> Callable:
    """
    Decorator that injects a DynamoDB table resource as a kwarg.
    
    Reads table name from environment variable and creates/caches
    the boto3 Table resource.
    
    Args:
        env_var: Environment variable name containing the table name
        kwarg_name: Name of the kwarg to inject (default: 'table')
    
    Usage:
        @api_handler
        @with_dynamodb_table('KEYWORDS_TABLE', 'keywords_table')
        @with_dynamodb_table('SEARCH_RESULTS_TABLE', 'search_table')
        def handler(event, context, keywords_table, search_table):
            response = keywords_table.scan()
            return success_response(response.get('Items', []), event)
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
            global _dynamodb_resource, _dynamodb_tables
            
            # Get table name from environment
            table_name = os.environ.get(env_var)
            if not table_name:
                logger.error(f"Environment variable {env_var} not set")
                return error_response(
                    Exception(f"Configuration error: {env_var} not set"),
                    event
                )
            
            # Initialize DynamoDB resource if needed
            if _dynamodb_resource is None:
                _dynamodb_resource = boto3.resource('dynamodb')
            
            # Get or create table reference
            if table_name not in _dynamodb_tables:
                _dynamodb_tables[table_name] = _dynamodb_resource.Table(table_name)
            
            kwargs[kwarg_name] = _dynamodb_tables[table_name]
            return func(event, context, **kwargs)
        
        return wrapper
    return decorator


# Convenience function to get multiple tables at once
def with_tables(**table_mappings: str) -> Callable:
    """
    Decorator that injects multiple DynamoDB tables.
    
    Args:
        **table_mappings: kwarg_name=ENV_VAR_NAME pairs
    
    Usage:
        @api_handler
        @with_tables(
            keywords_table='KEYWORDS_TABLE',
            search_table='SEARCH_RESULTS_TABLE'
        )
        def handler(event, context, keywords_table, search_table):
            # Both tables are available
            pass
    """
    def decorator(func: Callable) -> Callable:
        # Apply with_dynamodb_table decorators in reverse order
        decorated = func
        for kwarg_name, env_var in table_mappings.items():
            decorated = with_dynamodb_table(env_var, kwarg_name)(decorated)
        return decorated
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
    def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
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
        
        return func(event, context, **kwargs)
    
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
        def wrapper(event: Dict[str, Any], context: Any, **kwargs) -> Dict[str, Any]:
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
            
            return func(event, context, **kwargs)
        
        return wrapper
    return decorator


# Helper function to apply pagination to a list
def apply_pagination(
    items: list,
    limit: int,
    offset: int,
    sort_by: str = None,
    sort_order: str = 'desc'
) -> Dict[str, Any]:
    """
    Helper function to apply sorting and pagination to a list of items.
    
    Returns a dict with paginated items and metadata.
    
    Usage:
        @api_handler
        @paginate()
        def handler(event, context, limit, offset, sort_by, sort_order):
            items = fetch_all_items()
            result = apply_pagination(items, limit, offset, sort_by, sort_order)
            return success_response(result, event)
    """
    total = len(items)
    
    # Sort if sort_by is provided
    if sort_by and items:
        reverse = sort_order == 'desc'
        try:
            items = sorted(
                items,
                key=lambda x: x.get(sort_by, '') or '',
                reverse=reverse
            )
        except (TypeError, KeyError):
            pass  # Keep original order if sorting fails
    
    # Apply pagination
    paginated = items[offset:offset + limit]
    
    return {
        'items': paginated,
        'total': total,
        'limit': limit,
        'offset': offset,
        'has_more': offset + limit < total
    }


# =============================================================================
# Combined Convenience Decorators
# =============================================================================

def standard_list_handler(
    default_limit: int = 50,
    max_limit: int = 1000
) -> Callable:
    """
    Convenience decorator combining common patterns for list endpoints.
    
    Combines: @api_handler + @paginate
    
    Usage:
        @standard_list_handler(default_limit=20)
        def handler(event, context, limit, offset, sort_by, sort_order):
            items = fetch_items()
            return success_response(apply_pagination(
                items, limit, offset, sort_by, sort_order
            ), event)
    """
    def decorator(func: Callable) -> Callable:
        # Apply decorators in reverse order (innermost first)
        decorated = func
        decorated = paginate(default_limit, max_limit)(decorated)
        decorated = api_handler(decorated)
        return decorated
    return decorator
