"""Environment plumbing for tests of handlers that read configuration at import.

Handlers resolve their table names and ARNs at module level, so a test has to
have the variables in place *before* ``load_handler_module`` executes the file.
"""

from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from unittest.mock import patch

# The two names the Keywords-table handlers resolve their table from
# (``resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')``).
KEYWORDS_TABLE_ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords-table',
    'KEYWORDS_TABLE': 'test-keywords-table',
}


def setdefault_env(defaults: Mapping[str, str]) -> None:
    """``os.environ.setdefault`` for every pair, for modules loaded at collection time.

    Values already present win, so a developer shell pointing at real tables is
    left alone; the defaults only fill the gaps the handler needs to import.
    """
    for name, value in defaults.items():
        os.environ.setdefault(name, value)


@contextmanager
def cleared_env(*names: str) -> Iterator[None]:
    """Unset ``names`` for the block and restore the previous values afterwards."""
    with patch.dict(os.environ):
        for name in names:
            os.environ.pop(name, None)
        yield
