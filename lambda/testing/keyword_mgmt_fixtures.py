"""The stubbed ``keyword-mgmt.py`` router shared by the keyword routing suites.

``keyword-mgmt.py`` loads its sub-handlers lazily through ``HandlerLoader``;
seeding ``_handlers._cache`` with one distinct ``MagicMock`` per sub-handler
lets a test assert exactly which target ran without executing a real worker
or reaching AWS.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator, Mapping
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock

import pytest

from testing.module_loader import load_handler_module_offline

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')

# Every sub-handler `keyword-mgmt.py` can dispatch to.
KEYWORD_MGMT_SUB_HANDLERS = (
    'keyword-research.py',
    'get-keywords.py',
    'manage-keywords.py',
    'manage-keyword-groups.py',
    'promote-keywords.py',
)

type RouterStubs = dict[str, MagicMock]


def load_stubbed_keyword_mgmt(module_name: str) -> tuple[ModuleType, RouterStubs]:
    """Load ``keyword-mgmt.py`` fresh as ``module_name`` with every sub-handler stubbed.

    Each stub answers ``{'statusCode': 200, 'handler': <filename>}`` so results
    are distinguishable; returns ``(module, stubs_by_filename)``.
    """
    module = load_handler_module_offline(_API_DIR, 'keyword-mgmt.py', module_name)
    stubs: RouterStubs = {}
    for name in KEYWORD_MGMT_SUB_HANDLERS:
        stub = MagicMock(name=f'{name}_handler', return_value={'statusCode': 200, 'handler': name})
        module._handlers._cache[name] = stub
        stubs[name] = stub
    return module, stubs


def keyword_mgmt_router_fixture(module_name: str):
    """A function-scoped fixture yielding ``load_stubbed_keyword_mgmt(module_name)``.

    Assign the result to a module attribute; pytest registers the fixture under
    that name. The module is unregistered from ``sys.modules`` on teardown.
    """

    @pytest.fixture
    def _router() -> Iterator[tuple[ModuleType, RouterStubs]]:
        yield load_stubbed_keyword_mgmt(module_name)
        sys.modules.pop(module_name, None)

    return _router


def assert_dispatched_only_to(stubs: RouterStubs, target: str, event: Mapping[str, Any], result: object) -> None:
    """``target`` handled ``event`` exclusively and its result was returned unchanged."""
    stubs[target].assert_called_once_with(event, None)
    assert result == stubs[target].return_value, f'{event!r} did not return the {target} result'
    for name, stub in stubs.items():
        if name != target:
            stub.assert_not_called()


def assert_nothing_dispatched(stubs: RouterStubs) -> None:
    """No sub-handler was reached."""
    for stub in stubs.values():
        stub.assert_not_called()
