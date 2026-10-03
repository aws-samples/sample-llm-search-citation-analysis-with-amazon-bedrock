"""Shared setup for tests that load the search Lambda's ``handler.py``."""

from __future__ import annotations

from collections.abc import Mapping

# The table names ``search/handler.py`` resolves at import.
SEARCH_HANDLER_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-results',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brands',
    'RAW_RESPONSES_BUCKET': 'test-raw-responses',
}
