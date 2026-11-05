"""
The time budget of one Lambda invocation.

API Gateway gives a REST integration 29 s; past that the caller gets a 504
however close the Lambda was to answering, and the work already done is lost.
Page caps bound how much a request reads, not how long it takes: 25 one-MB
pages of Citations took 24 s at 512 MB on a customer's table. So every API
request carries a ``Deadline``, started by ``shared.decorators.api_handler``
from the Lambda's remaining time minus ``SAFETY_MARGIN_SECONDS`` (the margin
pays for building and serializing the answer).

Reads and fan-outs check ``current_deadline()`` between pages and keywords
and stop early instead of running into the 504; ``Deadline.cut`` records that
something stopped, so the handler can answer ``truncated: true`` (or a
cursor) and the reader knows the result is partial.

A Lambda container serves one invocation at a time, so the active deadline is
module state rather than a ``ContextVar``: ``map_scope_keywords``' worker
threads must see it, and threads do not inherit context variables.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

#: Seconds kept back from the Lambda's remaining time for building and returning the answer.
SAFETY_MARGIN_SECONDS = 4.0

#: Budget, in seconds, when no Lambda context says how long is left (tests, scripts, local runs).
DEFAULT_BUDGET_SECONDS = 25.0

#: The shortest budget a request gets, so a nearly expired context still reads one page.
MIN_BUDGET_SECONDS = 1.0


class Deadline:
    """A point in time after which bounded reads stop, and whether any of them did."""

    def __init__(self, seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._ends_at = clock() + seconds
        self.cut = False

    def expired(self) -> bool:
        return self._clock() >= self._ends_at

    def remaining(self) -> float:
        """Seconds left, never negative."""
        return max(0.0, self._ends_at - self._clock())

    def stop_reading(self, what: str) -> bool:
        """Whether ``what`` must stop now; the first stop is logged and marks the deadline ``cut``."""
        if not self.expired():
            return False
        if not self.cut:
            logger.warning('Request time budget spent; %s stopped early and the answer is partial', what)
        self.cut = True
        return True


class _Active:
    """Holder of the invocation's deadline (attribute state, so no ``global`` rebinding)."""

    deadline: Deadline | None = None


_ACTIVE = _Active()


def budget_from_context(context: Any, margin: float = SAFETY_MARGIN_SECONDS) -> float:
    """Seconds this invocation may spend: the Lambda's remaining time minus ``margin``.

    ``context`` without ``get_remaining_time_in_millis`` (``None`` in tests)
    gets ``DEFAULT_BUDGET_SECONDS``.
    """
    remaining_ms = getattr(context, 'get_remaining_time_in_millis', None)
    if not callable(remaining_ms):
        return DEFAULT_BUDGET_SECONDS
    remaining = remaining_ms()
    if not isinstance(remaining, (int, float)):
        return DEFAULT_BUDGET_SECONDS
    return max(MIN_BUDGET_SECONDS, remaining / 1000 - margin)


def start_request_deadline(context: Any, margin: float = SAFETY_MARGIN_SECONDS) -> Deadline:
    """Make a new deadline from ``context`` the active one and return it."""
    return activate_deadline(Deadline(budget_from_context(context, margin)))


def activate_deadline(deadline: Deadline) -> Deadline:
    """Make ``deadline`` the active one (a worker with its own budget, a test with a fake clock)."""
    _ACTIVE.deadline = deadline
    return deadline


def clear_request_deadline() -> None:
    """Forget the active deadline (the invocation is over)."""
    _ACTIVE.deadline = None


@contextmanager
def request_deadline_scope(context: Any) -> Generator[Deadline]:
    """A deadline from ``context`` active for the ``with`` block, cleared when it exits."""
    deadline = start_request_deadline(context)
    try:
        yield deadline
    finally:
        clear_request_deadline()


def current_deadline() -> Deadline:
    """The active invocation's deadline.

    Outside one (a worker Lambda that never called ``start_request_deadline``,
    a test) every call gets a fresh ``DEFAULT_BUDGET_SECONDS`` deadline that
    is not stored: storing it would leave a warm container permanently
    expired once that first budget ran out.
    """
    return _ACTIVE.deadline or Deadline(DEFAULT_BUDGET_SECONDS)
