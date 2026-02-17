"""
Shared Python modules for Citation Analysis Lambda functions.

This package contains common code used across all Lambda functions:
- config: Configuration management
- utils: Utility functions
- browser_tools: Browser automation with Bedrock AgentCore
- api_response: Secure API response utilities with CORS and error sanitization
"""

__version__ = "1.0.0"

from .config import LambdaConfig
from .utils import (
    normalize_url,
    get_timestamp,
    safe_json_dumps,
    safe_json_loads,
    truncate_text,
    extract_domain,
    create_error_response,
    create_success_response,
)
from .api_response import (
    get_cors_origin,
    get_cors_headers,
    sanitize_error_message,
    api_response,
    success_response,
    error_response,
    validation_error,
    not_found_response,
    DecimalEncoder,
)

__all__ = [
    "LambdaConfig",
    "normalize_url",
    "get_timestamp",
    "safe_json_dumps",
    "safe_json_loads",
    "truncate_text",
    "extract_domain",
    "create_error_response",
    "create_success_response",
    # API Response utilities
    "get_cors_origin",
    "get_cors_headers",
    "sanitize_error_message",
    "api_response",
    "success_response",
    "error_response",
    "validation_error",
    "not_found_response",
    "DecimalEncoder",
]
