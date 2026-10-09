"""
Step Function response utilities with consistent error handling.

Provides:
- Sanitized error messages for Step Functions handlers
- Consistent logging patterns
"""

import json
import logging
import traceback
from typing import Any

logger = logging.getLogger(__name__)


def sanitize_error_for_step_function(error: Exception) -> str:
    """
    Sanitize error message for Step Functions.
    Removes sensitive details while preserving useful debugging info.

    Args:
        error: The exception that occurred

    Returns:
        Safe error message
    """
    error_type = type(error).__name__

    # Map known error types to safe messages
    safe_messages = {
        'ValueError': 'Invalid input data',
        'KeyError': 'Missing required field',
        'TypeError': 'Invalid data type',
        'JSONDecodeError': 'Invalid JSON format',
        'ClientError': 'AWS service error',
        'ResourceNotFoundException': 'Resource not found',
        'ConditionalCheckFailedException': 'Database update conflict',
        'ProvisionedThroughputExceededException': 'Database throttled',
        'ThrottlingException': 'Service throttled',
        'AccessDeniedException': 'Access denied',
        'ConnectionError': 'Network connection failed',
        'TimeoutError': 'Operation timed out',
        'BotoCoreError': 'AWS SDK error',
    }

    # Return safe message if known error type
    if error_type in safe_messages:
        return f"{safe_messages[error_type]}: {error_type}"

    # For unknown errors, return generic message
    return f"Unexpected error: {error_type}"


def log_error(
    error: Exception,
    context: str,
    event: dict[str, Any] | None = None,
) -> None:
    """
    Log an error with consistent formatting.

    Args:
        error: The exception that occurred
        context: Description of what was being attempted
        event: Original event (will be sanitized)
    """
    error_type = type(error).__name__

    # Sanitize event for logging (remove potentially sensitive data)
    safe_event = None
    if event:
        safe_event = {k: v for k, v in event.items() if k not in ['api_key', 'secret', 'password', 'token']}

    logger.error('Error in %s: %s - %s', context, error_type, sanitize_error_for_step_function(error))

    if safe_event:
        logger.error('Event context: %s', json.dumps(safe_event, default=str)[:500])

    logger.error('Traceback:\n%s', traceback.format_exc())


def step_function_success(
    data: dict[str, Any],
    context: str = ""
) -> dict[str, Any]:
    """
    Create a standardized success response for Step Functions.

    Args:
        data: Response data
        context: Optional context for logging

    Returns:
        Success response dictionary
    """
    if context:
        logger.info('Success: %s', context)

    return {
        'status': 'success',
        **data
    }
