"""
Parallel item writes that stop at the request's time budget.

A bulk route (promoting 500 keywords, detaching a group's 5,000 members)
makes one DynamoDB write per item; serially that is 10-100 s at 256 MB, past
API Gateway's 29 s. ``map_writes`` runs them ``max_workers`` at a time and
does not start a write once ``shared.request_deadline.current_deadline()`` is
spent: those keys come back as ``pending`` so the route can answer what it
did and what is left (``truncated: true``) instead of a 504. Every caller's
writes are idempotent (conditional puts, set ``ADD``/``DELETE``), so sending
the pending keys again finishes the work.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from shared.request_deadline import current_deadline

#: Writes in flight at once. Ten matches botocore's default connection pool, so no thread waits for one.
WRITE_WORKERS = 10


@dataclass(frozen=True)
class Writes[KeyT, ResultT]:
    """The result of every write that ran, by key in input order, and the keys never started."""

    written: dict[KeyT, ResultT]
    pending: list[KeyT]


def map_writes[KeyT, ResultT](
    write: Callable[[KeyT], ResultT],
    keys: Sequence[KeyT],
    *,
    what: str,
    max_workers: int = WRITE_WORKERS,
) -> Writes[KeyT, ResultT]:
    """``write(key)`` for every key, ``max_workers`` at a time, until the request's deadline.

    A key not started when the deadline is spent is returned in ``pending``
    (and the deadline is marked ``cut``; ``what`` names the writes in the log).
    The first write that raises propagates once the in-flight writes finish.
    """
    deadline = current_deadline()

    # No annotations naming the type parameters on the inner function: CodeQL's
    # Python extractor does not scope PEP 695 type parameters into nested
    # definitions. It answers ``(result,)`` for a write that ran, ``None`` for one never started.
    def guarded(key):
        if deadline.stop_reading(what):
            return None
        return (write(key),)

    if not keys:
        return Writes({}, [])
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(keys)))) as pool:
        outcomes = list(pool.map(guarded, keys))
    written: dict[KeyT, ResultT] = {}
    pending: list[KeyT] = []
    for key, outcome in zip(keys, outcomes, strict=True):
        if outcome is None:
            pending.append(key)
        else:
            written[key] = outcome[0]
    return Writes(written, pending)
