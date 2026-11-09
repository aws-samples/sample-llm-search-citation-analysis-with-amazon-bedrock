"""Shared setup for tests that load the search Lambda's ``handler.py``."""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from types import ModuleType
from unittest.mock import patch

import pytest

from testing.env import setdefault_env
from testing.handler_fixtures import handler_fixture
from testing.module_loader import load_handler_module

# The table names ``search/handler.py`` resolves at import.
SEARCH_HANDLER_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-results',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brands',
    'RAW_RESPONSES_BUCKET': 'test-raw-responses',
}

_SEARCH_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'search')


def search_handler_fixture(module_name: str):
    """A fixture yielding ``search/handler.py`` loaded as ``module_name`` (``handler_fixture`` with this env)."""
    return handler_fixture(_SEARCH_DIR, 'handler.py', module_name, env=SEARCH_HANDLER_ENV)


def load_search_handler(module_name: str) -> ModuleType:
    """``search/handler.py`` loaded as ``module_name`` at collection time, for suites that use the module directly.

    The handler resolves its table names at import, so ``SEARCH_HANDLER_ENV``
    fills the gaps in ``os.environ`` first (``setdefault_env``: values already
    set win). The unique module name keeps the suite out of the contested
    ``sys.modules['handler']`` slot.
    """
    setdefault_env(SEARCH_HANDLER_ENV)
    return load_handler_module(_SEARCH_DIR, 'handler.py', module_name)


def nothing_stored_fixture(handler_fixture_name: str = 'search_handler'):
    """An autouse fixture: no earlier attempt of the run stored an answer (the resume read is stubbed).

    Without it the handler would read SearchResults through the module's
    inert DynamoDB client before asking any provider.
    """
    @pytest.fixture(autouse=True)
    def nothing_stored_yet(request: pytest.FixtureRequest) -> Iterator[None]:
        module = request.getfixturevalue(handler_fixture_name)
        with patch.object(module, 'stored_slim_results', return_value={}):
            yield

    return nothing_stored_yet
