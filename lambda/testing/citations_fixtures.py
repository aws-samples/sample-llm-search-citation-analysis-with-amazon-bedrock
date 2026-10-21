"""Loading and Citations rows shared by the ``get-citations.py`` (``GET /api/citations``) suites."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from testing.handler_fixtures import handler_fixture
from testing.module_loader import API_DIR

# What get-citations.py resolves at import: its Citations table and the Keywords table scopes read.
CITATIONS_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
}

VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'


def citations_handler(module_name: str):
    """A module-scoped fixture yielding ``get-citations.py`` loaded as ``module_name`` (assign it to the fixture name)."""
    return handler_fixture(API_DIR, 'get-citations.py', module_name, env=CITATIONS_ENV)


def citation_row(url: str, keyword: str, count: int = 1, **extra: Any) -> dict[str, Any]:
    """One Citations row: ``keyword`` cited ``url`` ``count`` times, through OpenAI."""
    return {'keyword': keyword, 'normalized_url': url, 'citation_count': count, 'citing_providers': ['openai'], **extra}
