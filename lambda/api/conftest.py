"""
Opt-in fixtures for loading the hyphenated `lambda/api` handler files in tests.

Context:
    Handler files in this directory are hyphenated (`promote-keywords.py`,
    `keyword-mgmt.py`), so they cannot be imported normally. They are loaded
    through `importlib.util.spec_from_file_location` under a unique module name
    (the `_load_router` pattern in `lambda/api/test_routers_404.py`). Each
    handler also resolves its DynamoDB table and builds a `boto3` resource at
    import time, so the required env vars must be set and `boto3` patched
    BEFORE the load happens, and `lambda/layer/python` must be on `sys.path` so
    `shared` resolves to the layer copy (the copy loaded in Lambda via
    `/opt/python`).

Isolation:
    NOTHING here is `autouse`, and nothing here runs at import time. A
    `conftest.py` applies to every test in its directory, and this directory
    also holds ~200 tests that predate these fixtures and carry their own
    bootstrap. An autouse `boto3` patch or env mutation would leak into them.
    Every fixture below is therefore requested BY NAME (directly or through
    `pytest.mark.usefixtures`), and every global mutation -- the `sys.path`
    entry, the `sys.modules` entries, the env vars, the `boto3` patch -- happens
    inside a fixture and is undone when it tears down.

Fixtures:
    `promotion_handler`    module-scoped `promote-keywords.py`, loaded under a
                           module name derived from the requesting test module
                           so two modules cannot evict each other's copy in one
                           pytest session
    `keyword_mgmt_router`  function-scoped `keyword-mgmt.py` with every
                           sub-handler stubbed, for router dispatch assertions
    `table_env_cleared`    function-scoped save / clear / restore of the
                           Keywords table env vars
"""

import contextlib
import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

API_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(API_DIR, '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')

PROMOTE_HANDLER_FILE = 'promote-keywords.py'
KEYWORD_MGMT_ROUTER_FILE = 'keyword-mgmt.py'

# Canonical + legacy table env vars read by `resolve_table_env` at module scope.
TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
TEST_TABLE_NAME = 'test-keywords-table'

# Env vars the keyword-mgmt sub-handlers read at import time. Set so no real AWS
# client could be built even if a sub-handler were ever loaded.
KEYWORD_MGMT_ENV = {
    'KEYWORD_RESEARCH_TABLE': 'test-keyword-research-table',
    'SECRETS_PREFIX': 'test-citation-analysis/',
    'DYNAMODB_TABLE_KEYWORDS': TEST_TABLE_NAME,
    'KEYWORDS_TABLE': TEST_TABLE_NAME,
}

# Every sub-handler `keyword-mgmt.py` can dispatch to. Each is stubbed with a
# distinct result so a test can assert exactly which target ran.
KEYWORD_MGMT_SUB_HANDLERS = (
    'keyword-research.py',
    'get-keywords.py',
    'manage-keywords.py',
    'promote-keywords.py',
)


def _prepare_import_boundary():
    """Put the layer copy of `shared` in front of `sys.path` for a handler load.

    `shared/__init__.py` re-exports `api_response` as a function, shadowing the
    submodule, so the real module object is bound explicitly -- otherwise a
    handler's `from shared.api_response import ...` resolves to the function.
    """
    if _LAYER_PY not in sys.path:
        sys.path.insert(0, _LAYER_PY)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')


@contextlib.contextmanager
def _handler_loaded(handler_file, module_name, env):
    """Load a hyphenated handler with `env` set and `boto3` patched, then clean up.

    The patches are applied inside a `with` block wrapping the `yield`, so no
    stubbed `boto3` and no env value leaks into another test module in the same
    pytest session.
    """
    saved = {name: os.environ.get(name) for name in env}
    os.environ.update(env)

    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        _prepare_import_boundary()
        sys.modules.pop(module_name, None)
        spec = importlib.util.spec_from_file_location(
            module_name, os.path.join(API_DIR, handler_file)
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        yield module

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(module_name, None)


@pytest.fixture(scope='module')
def promotion_handler(request):
    """`promote-keywords.py`, loaded once for the requesting test module."""
    module_name = f'{request.module.__name__}_promote_keywords_under_test'
    env = dict.fromkeys(TABLE_ENV_VARS, TEST_TABLE_NAME)

    with _handler_loaded(PROMOTE_HANDLER_FILE, module_name, env) as module:
        yield module


@pytest.fixture
def keyword_mgmt_router(request):
    """Fresh `keyword-mgmt.py` router with every sub-handler stubbed distinctly.

    Seeding the router's `HandlerLoader` cache (`_handlers._cache`) means no real
    sub-handler file is ever loaded or executed, so dispatch is asserted without
    reaching AWS. Yields `(module, stubs_by_filename)`.
    """
    module_name = f'{request.module.__name__}_keyword_mgmt_under_test'

    with _handler_loaded(KEYWORD_MGMT_ROUTER_FILE, module_name, KEYWORD_MGMT_ENV) as module:
        stubs = {}
        for name in KEYWORD_MGMT_SUB_HANDLERS:
            stub = MagicMock(name=f'{name}_handler')
            stub.return_value = {'statusCode': 200, 'handler': name}
            module._handlers._cache[name] = stub
            stubs[name] = stub

        yield module, stubs


@pytest.fixture
def table_env_cleared():
    """Save, clear, and restore the Keywords table env vars around one test."""
    saved = {name: os.environ.get(name) for name in TABLE_ENV_VARS}
    for name in TABLE_ENV_VARS:
        os.environ.pop(name, None)

    yield

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
