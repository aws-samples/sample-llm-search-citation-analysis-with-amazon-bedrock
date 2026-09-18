"""pytest fixture factory for handlers that build AWS clients at import time."""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator, Mapping
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module


def handler_fixture(
    directory: str,
    filename: str,
    module_name: str,
    *,
    env: Mapping[str, str],
    scope: str = 'module',
):
    """Build a fixture yielding ``filename`` loaded under ``module_name``.

    While the fixture is alive ``env`` is in place and ``boto3.resource`` /
    ``boto3.client`` return inert ``MagicMock`` clients, exactly as the
    per-file bootstraps used to arrange by hand; tests swap the module-level
    clients they care about with ``patch.object``. The module is unregistered
    from ``sys.modules`` on teardown so a later load starts clean.

    Assign the result to a module attribute -- pytest registers the fixture
    under that name::

        promotion_handler = handler_fixture(_API_DIR, 'promote-keywords.py', _MODULE_NAME, env=KEYWORDS_TABLE_ENV)
    """

    @pytest.fixture(scope=scope)
    def _loaded_handler() -> Iterator[ModuleType]:
        with (
            patch.dict(os.environ, env),
            patch('boto3.resource', MagicMock(name='boto3.resource')),
            patch('boto3.client', MagicMock(name='boto3.client')),
        ):
            yield load_handler_module(directory, filename, module_name)
        sys.modules.pop(module_name, None)

    return _loaded_handler
