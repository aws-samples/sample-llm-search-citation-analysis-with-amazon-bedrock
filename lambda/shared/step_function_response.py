"""
Step Function response utilities with consistent error handling.

Provides:
- Sanitized error messages for Step Functions handlers
- Consistent logging patterns
- Error classification for retry logic
"""

import json
import logging
import traceback
from typing import Any, Dict, Optional

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


def is_retryable_error(error: Exception) -> bool:
    """
    Determine if an error is retryable.
    
    Args:
        error: The exception that occurred
        
    Returns:
        True if the error is retryable
    """
    error_type = type(error).__name__
    error_str = str(error).lower()
    
    retryable_types = {
        'ProvisionedThroughputExceededException',
        'ThrottlingException',
        'ServiceUnavailableException',
        'InternalServerError',
        'ConnectionError',
        'TimeoutError',
    }
    
    retryable_keywords = [
        'throttl',
        'rate limit',
        'too many requests',
        'service unavailable',
        'timeout',
        'connection',
    ]
    
    if error_type in retryable_types:
        return True
    
    for keyword in retryable_keywords:
        if keyword in error_str:
            return True
    
    return False


def log_error(
    error: Exception,
    context: str,
    event: Optional[Dict[str, Any]] = None,
    include_traceback: bool = True
) -> None:
    """
    Log an error with consistent formatting.
    
    Args:
        error: The exception that occurred
        context: Description of what was being attempted
        event: Original event (will be sanitized)
        include_traceback: Whether to include full traceback
    """
    error_type = type(error).__name__
    
    # Sanitize event for logging (remove potentially sensitive data)
    safe_event = None
    if event:
        safe_event = {k: v for k, v in event.items() if k not in ['api_key', 'secret', 'password', 'token']}
    
    logger.error(f"Error in {context}: {error_type} - {sanitize_error_for_step_function(error)}")
    
    if safe_event:
        logger.error(f"Event context: {json.dumps(safe_event, default=str)[:500]}")
    
    if include_traceback:
        logger.error(f"Traceback:\n{traceback.format_exc()}")


def step_function_error(
    error: Exception,
    context: str,
    event: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create a standardized error response for Step Functions.
    
    Args:
        error: The exception that occurred
        context: Description of what was being attempted
        event: Original event
        
    Returns:
        Error response dictionary
    """
    # Log the error
    log_error(error, context, event)
    
    error_response = {
        'status': 'error',
        'error': sanitize_error_for_step_function(error),
        'error_type': type(error).__name__,
        'retryable': is_retryable_error(error),
    }
    
    return error_response


def step_function_success(
    data: Dict[str, Any],
    context: str = ""
) -> Dict[str, Any]:
    """
    Create a standardized success response for Step Functions.
    
    Args:
        data: Response data
        context: Optional context for logging
        
    Returns:
        Success response dictionary
    """
    if context:
        logger.info(f"Success: {context}")
    
    return {
        'status': 'success',
        **data
    }
