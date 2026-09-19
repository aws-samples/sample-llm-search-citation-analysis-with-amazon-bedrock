"""The handler fixture shared by the promote-keywords suites (``test_promote_keywords_*``).

``promote-keywords.py`` is hyphenated and builds a ``boto3`` DynamoDB resource
at import time, so each suite loads it fresh under a module name unique to
that file, with the table env vars set and ``boto3`` patched BEFORE the load.
The suites then run with those variables *unset*: the loaded handler must not
re-read them, and one that did would fail loudly instead of silently picking
up a developer shell's real table names. Every global mutation is undone on
teardown; nothing here is autouse, so the pre-existing tests in the directory
are untouched.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from types import ModuleType
from unittest.mock import patch

import pytest

from testing.env import KEYWORDS_TABLE_ENV, cleared_env
from testing.module_loader import load_handler_module_offline

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')


def promotion_handler_fixture(module_name: str):
    """A module-scoped fixture yielding ``promote-keywords.py`` loaded as ``module_name``.

    Assign the result to ``promotion_handler`` in the suite so pytest registers
    the fixture under that name::

        promotion_handler = promotion_handler_fixture('promote_keywords_under_test_unicode')
    """

    @pytest.fixture(scope='module')
    def _loaded_handler() -> Iterator[ModuleType]:
        with patch.dict(os.environ, KEYWORDS_TABLE_ENV):
            module = load_handler_module_offline(_API_DIR, 'promote-keywords.py', module_name)
        with cleared_env(*KEYWORDS_TABLE_ENV):
            yield module
        sys.modules.pop(module_name, None)

    return _loaded_handler
