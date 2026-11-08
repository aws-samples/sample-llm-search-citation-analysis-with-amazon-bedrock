"""
The audit's polite fetcher: every request to the audited site goes through one ``Throttle``.

Before a request it waits for the throttle (1 request/s, longer after a 429). A 429 is retried at most
``MAX_URL_RETRIES`` times, each after the back-off the throttle sets; the crawl stops once the throttle says so.
When the next allowed request lies beyond the step's soft deadline, ``FetchDeferredError`` is raised so the step can end
and Step Functions waits instead of a Lambda sleeping (the URL is crawled by the next step).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from shared.audit_fetch import FetchResult, fetch_following, fetch_once
from shared.audit_throttle import MAX_URL_RETRIES, Throttle, now_ms
from shared.audit_urls import is_crawlable

#: Waits up to this happen inside the step (the 1 request/s spacing, a short Retry-After); a longer one ends the
#: step (``FetchDeferredError``) and becomes the state machine's ``wait_seconds``, so no Lambda sleeps through it.
#: (TENETS.md, tenets 7 and 8: a short, bounded backoff only).
MAX_IN_STEP_WAIT_MS = 3_000


class FetchDeferredError(Exception):
    """The next request may only be sent after ``wait_ms``; end the step and resume later."""

    def __init__(self, wait_ms: int) -> None:
        super().__init__(f'next request in {wait_ms} ms')
        self.wait_ms = wait_ms


@dataclass
class PoliteFetcher:
    throttle: Throttle
    deadline: float | None = None
    """``time.monotonic()`` value after which no wait may end inside this step."""
    sleep: Callable[[float], None] | None = None
    """How to wait (``time.sleep`` when unset)."""

    def _wait(self) -> None:
        wait = self.throttle.wait_ms(now_ms())
        if wait <= 0:
            return
        past_deadline = self.deadline is not None and time.monotonic() + wait / 1000 > self.deadline
        if wait > MAX_IN_STEP_WAIT_MS or past_deadline:
            raise FetchDeferredError(wait)
        (self.sleep or time.sleep)(wait / 1000)

    def fetch(
        self,
        url: str,
        *,
        max_bytes: int,
        accept: str,
        timeout_s: float,
        follow_hop: Callable[[str], bool] | None = None,
    ) -> FetchResult:
        """GET ``url`` politely; with ``follow_hop`` redirects accepted by it are followed (else none are)."""
        result = FetchResult(url=url, status=0, error='not_sent')
        for _attempt in range(MAX_URL_RETRIES + 1):
            if self.throttle.stopped:
                return result
            self._wait()
            self.throttle.record_request(now_ms())
            if follow_hop is None:
                result = fetch_once(url, max_bytes=max_bytes, accept=accept, timeout_s=timeout_s)
            else:
                result = fetch_following(
                    url, max_bytes=max_bytes, accept=accept, timeout_s=timeout_s,
                    allow_hop=lambda target: is_crawlable(target) and follow_hop(target),
                )
            if result.status != 429:
                self.throttle.record_response()
                return result
            self.throttle.record_rate_limited(result.headers.get('retry-after'), now_ms())
        return result
