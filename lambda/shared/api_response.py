"""
API Response utilities with security features.

Provides:
- CORS header management with CloudFront origin restriction
- Sanitized error responses (no internal details leaked)
- Standardized API response format
"""

import json
import logging
import os
import traceback
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Re-exported: DecimalEncoder's canonical home is shared.dynamo_decimal
# (bugs.md 3.4); existing importers keep using shared.api_response.
from shared.dynamo_decimal import DecimalEncoder as DecimalEncoder

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Cache for CORS origin
_cors_origin_cache: str | None = None


def get_cors_origin() -> str:
    """
    Get the allowed CORS origin from SSM Parameter Store.
    Fails closed when CORS_ORIGIN_PARAM is not set, unless ALLOW_DEV_CORS=true.

    Returns:
        Allowed CORS origin URL, or empty string if misconfigured (fail closed)
    """
    global _cors_origin_cache

    if _cors_origin_cache is not None:
        return _cors_origin_cache

    param_name = os.environ.get('CORS_ORIGIN_PARAM')

    if not param_name:
        # Fail closed: only allow wildcard if explicitly opted in for local development
        if os.environ.get('ALLOW_DEV_CORS', '').lower() == 'true':
            logger.warning("CORS_ORIGIN_PARAM not set, ALLOW_DEV_CORS=true — using wildcard (dev mode)")
            _cors_origin_cache = '*'
        else:
            logger.warning("CORS_ORIGIN_PARAM not set and ALLOW_DEV_CORS not enabled — blocking CORS (fail closed)")
            _cors_origin_cache = ''
        return _cors_origin_cache

    try:
        ssm = boto3.client('ssm')
        response = ssm.get_parameter(Name=param_name)
        _cors_origin_cache = response['Parameter']['Value']
        logger.info(f"CORS origin loaded: {_cors_origin_cache}")
        return _cors_origin_cache
    except ClientError as e:
        # Fail closed for THIS request, but deliberately do NOT cache the
        # failure. The sentinel check above is `is not None`, so a cached ''
        # is indistinguishable from a successful lookup that returned '' —
        # one SSM ThrottlingException would blank Access-Control-Allow-Origin
        # for the rest of the warm container's life, producing minutes to
        # hours of "works for me / broken for you" browser CORS errors from a
        # single ERROR line at cold start (AUDIT-2026-08-19 §2.13).
        #
        # Leaving the cache unset means the next request retries SSM.
        logger.error(f"Failed to get CORS origin from SSM: {e}")
        return ''


def get_cors_headers(request_origin: str | None = None) -> dict[str, str]:
    """
    Get CORS headers, validating against allowed origin.

    Args:
        request_origin: Origin header from the request (optional)

    Returns:
        Dictionary of CORS headers
    """
    allowed_origin = get_cors_origin()

    # If allowed origin is wildcard (dev mode), allow any origin
    if allowed_origin == '*':
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        }

    # In production, only allow the specific CloudFront origin
    # Also allow localhost for local development (opt-in only)
    allowed_origins = set()
    if allowed_origin:
        allowed_origins.add(allowed_origin)

    # Only allow localhost if explicitly opted in (default: false in production)
    if os.environ.get('ALLOW_LOCALHOST', 'false').lower() == 'true':
        allowed_origins.update(['http://localhost:3000', 'http://localhost:5173'])

    # Check if request origin is in the allowed set
    if request_origin and request_origin in allowed_origins:
        return {
            'Access-Control-Allow-Origin': request_origin,
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true',
            'Vary': 'Origin',
        }

    # Default to the primary allowed origin (CloudFront URL from SSM)
    # This ensures CORS works even if the Origin header is missing or unexpected
    if allowed_origin:
        return {
            'Access-Control-Allow-Origin': allowed_origin,
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true',
            'Vary': 'Origin',
        }

    # No allowed origin configured — fail closed
    return {
        'Access-Control-Allow-Origin': '',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    }


def sanitize_error_message(error: Exception) -> str:
    """
    Sanitize error message for client response.
    Removes internal details, stack traces, and sensitive information.

    Args:
        error: The exception that occurred

    Returns:
        Safe error message for client
    """
    error_type = type(error).__name__

    # Map known error types to safe messages
    safe_messages = {
        'ValidationError': 'Invalid request data',
        'KeyError': 'Missing required field',
        'ValueError': 'Invalid value provided',
        'TypeError': 'Invalid data type',
        'JSONDecodeError': 'Invalid JSON format',
        'ClientError': 'Service temporarily unavailable',
        'ResourceNotFoundException': 'Resource not found',
        'ConditionalCheckFailedException': 'Update conflict, please retry',
        'ProvisionedThroughputExceededException': 'Service busy, please retry',
        'ThrottlingException': 'Too many requests, please slow down',
        'AccessDeniedException': 'Access denied',
        'UnauthorizedException': 'Authentication required',
    }

    # Return safe message if known error type
    if error_type in safe_messages:
        return safe_messages[error_type]

    # For unknown errors, return generic message
    # Log the full error for debugging
    logger.error(f"Unhandled error type {error_type}: {error!s}")
    logger.error(traceback.format_exc())

    return 'An unexpected error occurred'


def api_response(
    status_code: int,
    body: Any,
    event: dict | None = None,
    headers: dict[str, str] | None = None
) -> dict[str, Any]:
    """
    Create a standardized API response with CORS headers.

    Args:
        status_code: HTTP status code
        body: Response body (will be JSON serialized)
        event: Original Lambda event (used to extract Origin header)
        headers: Additional headers to include

    Returns:
        API Gateway response dictionary
    """
    # Get request origin from event
    request_origin = None
    if event:
        request_headers = event.get('headers') or {}
        # Headers can be case-insensitive
        request_origin = (
            request_headers.get('origin') or
            request_headers.get('Origin') or
            request_headers.get('ORIGIN')
        )

    # Build response headers
    response_headers = {
        'Content-Type': 'application/json',
        **get_cors_headers(request_origin),
    }

    if headers:
        response_headers.update(headers)

    return {
        'statusCode': status_code,
        'headers': response_headers,
        'body': json.dumps(body, cls=DecimalEncoder, default=str),
    }


def success_response(
    data: Any,
    event: dict | None = None,
    status_code: int = 200
) -> dict[str, Any]:
    """
    Create a success response.

    Args:
        data: Response data
        event: Original Lambda event
        status_code: HTTP status code (default 200)

    Returns:
        API Gateway response dictionary
    """
    return api_response(status_code, data, event)


def error_response(
    error: Exception,
    event: dict | None = None,
    status_code: int = 500,
    error_code: str | None = None
) -> dict[str, Any]:
    """
    Create a sanitized error response.

    Args:
        error: The exception that occurred
        event: Original Lambda event
        status_code: HTTP status code (default 500)
        error_code: Optional error code for client handling

    Returns:
        API Gateway response dictionary
    """
    body = {
        'error': sanitize_error_message(error),
    }

    if error_code:
        body['code'] = error_code

    return api_response(status_code, body, event)


def validation_error(
    message: str,
    event: dict | None = None,
    field: str | None = None
) -> dict[str, Any]:
    """
    Create a validation error response.

    Args:
        message: Validation error message
        event: Original Lambda event
        field: Optional field name that failed validation

    Returns:
        API Gateway response dictionary
    """
    body = {'error': message}
    if field:
        body['field'] = field

    return api_response(400, body, event)


def not_found_response(
    resource: str = 'Resource',
    event: dict | None = None
) -> dict[str, Any]:
    """
    Create a not found response.

    Args:
        resource: Name of the resource not found
        event: Original Lambda event

    Returns:
        API Gateway response dictionary
    """
    return api_response(404, {'error': f'{resource} not found'}, event)


def forbidden_response(
    message: str = 'Forbidden',
    event: dict | None = None
) -> dict[str, Any]:
    """
    Create an authorization failure response.

    403, not 401: the caller authenticated successfully (API Gateway's Cognito
    authorizer already rejected bad tokens with a 401) but lacks the privilege
    for this operation. Retrying with the same token will not help, so the
    frontend must not treat this as a session-expiry signal.

    The message is deliberately generic — it must not disclose which group is
    required, who the caller is, or whether the target resource exists.

    Args:
        message: Safe, non-disclosing reason for the refusal
        event: Original Lambda event

    Returns:
        API Gateway response dictionary
    """
    return api_response(403, {'error': message}, event)
