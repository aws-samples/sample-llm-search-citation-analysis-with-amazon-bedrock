"""
Detect background jobs that died without recording a terminal status.

Async job rows (Content Studio generation, keyword research) move
``pending -> processing -> completed|failed``. The worker's ``except`` blocks
cover Python-level errors, but a Lambda **timeout is a SIGKILL**: no exception
is raised, no handler runs, and the row is stranded in a non-terminal state
forever. Nothing else advances it, so the UI polls a spinner indefinitely
(AUDIT-2026-08-19 §2.9).

The fix is a reader-side sweep: whenever a non-terminal row is read, if it has
outlived the worker's own budget it cannot still be running, so mark it failed.
This module holds the elapsed-time check that sweep needs, because getting it
subtly wrong in each of the three call sites is how the original bug spread.

Choosing ``timeout_seconds``: it MUST exceed the worker Lambda's configured
timeout. A threshold below the Lambda timeout marks still-running jobs as
failed, which then flip back to success on completion — a worse inconsistency
than the one being fixed.
"""

from __future__ import annotations

import logging
from datetime import datetime

from .utils import utc_now

logger = logging.getLogger(__name__)


def stale_elapsed_seconds(
    created_at: str,
    timeout_seconds: float,
    *,
    now: datetime | None = None,
) -> float | None:
    """Seconds elapsed since ``created_at``, but only if past ``timeout_seconds``.

    Args:
        created_at: ISO-8601 creation timestamp. A trailing ``Z`` is accepted
            and read as UTC.
        timeout_seconds: The worker's budget. Must be greater than the worker
            Lambda's timeout — see the module docstring.
        now: Override for the current time, for tests.

    Returns:
        The elapsed seconds when the row has outlived its budget and should be
        marked failed. ``None`` when it is still within budget, or when
        ``created_at`` is missing or unparseable.

        An unparseable timestamp returns ``None`` deliberately: a parse glitch
        must not mark a healthy in-flight job as failed. It is logged so the
        bad data is visible rather than silently tolerated.
    """
    if not created_at:
        return None

    reference = now if now is not None else utc_now()
    try:
        created = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
    except (ValueError, TypeError) as exc:
        logger.warning(f"Could not parse created_at {created_at!r}: {exc}")
        return None

    if created.tzinfo is None:
        # Naive timestamps are historical rows written before timestamps
        # carried an offset. Compare naive-to-naive rather than raising.
        reference = reference.replace(tzinfo=None)

    elapsed = (reference - created).total_seconds()
    return elapsed if elapsed > timeout_seconds else None
