"""Request deadlines for tests: spent ones, ones that run out after a fixed number of checks, and where to put them.

``shared.request_deadline.Deadline`` takes a clock; these give it fake ones so
a test decides exactly when the time budget ends, independent of how fast
the machine runs or how the worker threads are scheduled.
"""

from __future__ import annotations

import itertools
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import patch

from shared import bounded_writes
from shared.request_deadline import Deadline


def spent_deadline() -> Deadline:
    """A deadline already over: a capped read stops after its first page, a fan-out or write batch starts nothing."""
    return Deadline(0, lambda: 1.0)


def deadline_after_checks(checks: int) -> Deadline:
    """A deadline that lets exactly ``checks`` checks through and is spent from the next one on.

    Its clock reads 0 when the deadline is made and one more on every later
    read; each ``stop_reading`` reads it once, thread-safely (``itertools.count``).
    """
    ticks = itertools.count()
    return Deadline(checks + 1, lambda: next(ticks))


@contextmanager
def writes_deadline(deadline: Deadline) -> Generator[Deadline]:
    """``deadline`` as the one ``shared.bounded_writes.map_writes`` checks, for the ``with`` block."""
    with patch.object(bounded_writes, 'current_deadline', return_value=deadline):
        yield deadline


@contextmanager
def capped_reads_deadline(deadline: Deadline) -> Generator[Deadline]:
    """``deadline`` as the one capped DynamoDB reads (``shared.dynamodb_batch``) check, for the ``with`` block."""
    with patch('shared.dynamodb_batch.current_deadline', return_value=deadline):
        yield deadline
