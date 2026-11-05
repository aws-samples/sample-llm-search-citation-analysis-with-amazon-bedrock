"""Fake time budgets for the tests of reads that stop at ``shared.request_deadline``'s deadline.

``ticking_deadline(n)`` expires once its clock has been read ``n`` times, so a
test decides how many deadline checks a read passes before it stops.
``spent_request_budget`` makes every request started inside it begin with no
time left, as a Lambda invoked with 4 s to go would; ``window_read_budget``
gives the windowed reads of ``shared.scoped_reports`` a deadline of the test's
choosing.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Generator
from contextlib import contextmanager
from unittest.mock import patch

from shared import request_deadline
from shared.request_deadline import Deadline


def ticking_deadline(checks: int) -> Deadline:
    """A deadline that passes ``checks`` checks (each clock read advances one second) and is expired from then on."""
    ticks = itertools.count()
    return Deadline(checks, lambda: float(next(ticks)))


def expired_deadline() -> Deadline:
    """A deadline that is already expired."""
    return Deadline(0, lambda: 1.0)


@contextmanager
def spent_request_budget() -> Generator[None]:
    """Every request ``@api_handler`` starts inside the block begins with an expired deadline."""
    with patch.object(request_deadline, 'budget_from_context', return_value=0.0):
        yield


@contextmanager
def window_read_budget(make: Callable[[], Deadline]) -> Generator[None]:
    """Every window read of ``shared.scoped_reports`` inside the block stops at ``make()``'s deadline."""
    with patch('shared.scoped_reports.window_read_deadline', side_effect=make):
        yield
