"""Loading and the SearchResults key schema shared by the ``get-searches.py`` (``GET /api/searches``) suites."""

from __future__ import annotations

from collections.abc import Mapping

from testing.handler_fixtures import handler_fixture
from testing.module_loader import API_DIR

SEARCHES_ENV: Mapping[str, str] = {'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results', 'CORS_ORIGIN_PARAM': ''}

#: The SearchResults table key and its ``ProviderIndex``, for ``testing.partition_tables.PagedTable``.
SEARCH_RESULTS_INDEXES: Mapping[str | None, tuple[str, ...]] = {
    None: ('keyword', 'timestamp_provider'),
    'ProviderIndex': ('provider', 'timestamp'),
}


def searches_handler(module_name: str):
    """A module-scoped fixture yielding ``get-searches.py`` loaded as ``module_name`` (assign it to the fixture name)."""
    return handler_fixture(API_DIR, 'get-searches.py', module_name, env=SEARCHES_ENV)
