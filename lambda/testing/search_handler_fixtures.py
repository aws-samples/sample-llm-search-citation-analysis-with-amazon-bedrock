"""Shared setup for tests that load the search Lambda's ``handler.py``."""

from __future__ import annotations

from collections.abc import Mapping

# The table names ``search/handler.py`` resolves at import, under both the
# ``DYNAMODB_TABLE_*`` names and the legacy ones it falls back to.
SEARCH_HANDLER_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-results',
    'SEARCH_RESULTS_TABLE': 'test-results',
    'PROVIDER_CONFIG_TABLE': 'test-provider-config',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
    'BRAND_CONFIG_TABLE': 'test-brands',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brands',
}
