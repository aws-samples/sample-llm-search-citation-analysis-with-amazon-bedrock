"""
Shared Python modules for Citation Analysis Lambda functions.

This package contains common code used across all Lambda functions:
- config: Configuration management
- utils: Utility functions
- browser_tools: Browser automation with Bedrock AgentCore
- api_response: Secure API response utilities with CORS and error sanitization
"""

__version__ = "1.0.0"

from .api_response import (
    DecimalEncoder,
    api_response,
    error_response,
    get_cors_headers,
    get_cors_origin,
    not_found_response,
    sanitize_error_message,
    success_response,
    validation_error,
)
from .config import LambdaConfig
from .utils import (
    brand_names_match,
    classify_brand,
    extract_domain,
    get_timestamp,
    get_timestamp_compact,
    normalize_url,
    utc_now,
)

__all__ = [
    "DecimalEncoder",
    "LambdaConfig",
    "api_response",
    "brand_names_match",
    "classify_brand",
    "error_response",
    "extract_domain",
    "get_cors_headers",
    "get_cors_origin",
    "get_timestamp",
    "get_timestamp_compact",
    "normalize_url",
    "not_found_response",
    "sanitize_error_message",
    "success_response",
    "utc_now",
    "validation_error",
]
