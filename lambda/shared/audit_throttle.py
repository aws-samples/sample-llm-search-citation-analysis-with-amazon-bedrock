"""
Politeness of the audit crawler: one request per second, and a back-off when the site answers 429.

Requests to the audited origin are spaced at least ``interval_ms`` apart (1 s to start). On a 429:

* ``consecutive`` grows by one and the interval doubles (at most 30 s);
* the whole origin pauses for ``max(interval, Retry-After)``; without a ``Retry-After`` (seconds or an HTTP
  date) the pause is ``30 s x 2^(consecutive - 1)``;
* one URL is retried at most ``MAX_URL_RETRIES`` times.

Any other answer resets ``consecutive``. The crawl stops (``stopped``) once more than three 429s arrive in a
row or the pauses add up to more than 30 minutes: past that point the site is asking not to be crawled, and
the audit reports it (``crawl-rate-limited``) instead of hammering it.

The state is a small JSON object saved on the audit between crawl chunks (``to_state`` / ``from_state``).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

INITIAL_INTERVAL_MS = 1_000
MAX_INTERVAL_MS = 30_000
BASE_COOLDOWN_MS = 30_000
MAX_CONSECUTIVE_RATE_LIMITS = 3
MAX_TOTAL_COOLDOWN_MS = 30 * 60 * 1_000
MAX_URL_RETRIES = 3


def retry_after_ms(value: str | None, now_ms: int) -> int | None:
    """``Retry-After`` in milliseconds from ``now_ms`` (delta seconds or an HTTP date), or ``None``."""
    if not value or not value.strip():
        return None
    text = value.strip()
    if text.isdigit():
        return int(text) * 1_000
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return max(0, int(when.timestamp() * 1_000) - now_ms)


def now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1_000)


def _int(state: dict[str, Any], key: str, default: int) -> int:
    value = state.get(key, default)
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else default


@dataclass
class Throttle:
    """Per-audit request spacing and 429 back-off (all times epoch milliseconds)."""

    interval_ms: int = INITIAL_INTERVAL_MS
    next_request_at: int = 0
    paused_until: int = 0
    consecutive: int = 0
    cooldown_ms: int = 0

    @classmethod
    def from_state(cls, state: object) -> Throttle:
        if not isinstance(state, dict):
            return cls()
        return cls(
            interval_ms=_int(state, 'interval_ms', INITIAL_INTERVAL_MS),
            next_request_at=_int(state, 'next_request_at', 0),
            paused_until=_int(state, 'paused_until', 0),
            consecutive=_int(state, 'consecutive', 0),
            cooldown_ms=_int(state, 'cooldown_ms', 0),
        )

    def to_state(self) -> dict[str, int]:
        return asdict(self)

    def wait_ms(self, now: int) -> int:
        """Milliseconds to wait before the next request may be sent."""
        return max(0, max(self.next_request_at, self.paused_until) - now)

    def record_request(self, now: int) -> None:
        self.next_request_at = now + self.interval_ms

    def record_response(self) -> None:
        """A non-429 answer: the site is not asking us to slow down any more."""
        self.consecutive = 0

    def record_rate_limited(self, retry_after: str | None, now: int) -> int:
        """Register a 429 and return the pause (ms) applied to the whole origin."""
        self.consecutive += 1
        self.interval_ms = min(MAX_INTERVAL_MS, self.interval_ms * 2)
        asked = retry_after_ms(retry_after, now)
        fallback = BASE_COOLDOWN_MS * 2 ** (self.consecutive - 1)
        delay = max(self.interval_ms, asked if asked is not None else fallback)
        self.paused_until = now + delay
        self.cooldown_ms += delay
        return delay

    @property
    def stopped(self) -> bool:
        """Whether the crawl must stop: too many 429s in a row, or too much time spent paused."""
        return self.consecutive > MAX_CONSECUTIVE_RATE_LIMITS or self.cooldown_ms > MAX_TOTAL_COOLDOWN_MS
