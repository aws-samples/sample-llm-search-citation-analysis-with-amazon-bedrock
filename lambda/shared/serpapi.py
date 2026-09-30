"""
SerpAPI searches through async submit + Search Archive polling.

A synchronous SerpAPI request holds the connection until Google answers. On
the free plan's "Best Effort" speed tier that answer is usually a few seconds
but has a long tail: on the 2026-09-30 run, SerpAPI's own
``search_metadata.total_time_taken`` was 6.5 s at the median, 64 s at p90 and
78 s at worst. The old client gave up after 30 s and re-sent the search, five
times, so 5 of 44 keywords got no SerpAPI results at all and the run was
reported degraded.

With ``async=true`` the submit answers in well under a second with a search
id, and the result is fetched from the Search Archive
(``/searches/<id>.json``) once SerpAPI has it. A slow search is waited for
instead of being re-submitted, and fetching an archived search is free: only a
new search with a new id uses a search credit (SerpAPI FAQ, "Do Search Archive
API queries deduct search credits?").

Failures that waiting cannot fix are raised straight away:
``SerpApiQuotaExhaustedError`` when the account has run out of searches (a 429
whose body says so; a 429 without that text is the hourly throughput limit and
is retried), and ``SerpApiError`` for any other 4xx or a search SerpAPI itself
marks as failed.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

SERPAPI_SEARCH_URL = 'https://serpapi.com/search'
SERPAPI_ARCHIVE_URL = 'https://serpapi.com/searches/{search_id}.json'

#: Seconds for one HTTP request (a submit or one archive read); both answer in
#: well under a second when SerpAPI is healthy.
REQUEST_TIMEOUT_SECONDS = 20
#: Attempts per HTTP request for network errors, 5xx and hourly-limit 429s.
MAX_REQUEST_ATTEMPTS = 5
#: How long a submitted search may stay Queued/Processing before it is given
#: up on. The slowest search measured on the free plan was 78 s on the
#: 2026-09-30 run and 177 s in the async benchmark later that day (5 in
#: flight), so 180 s was one slow search away from failing a call. Waiting is
#: free (archive reads use no credit); the SerpAPI search Lambda's timeout
#: must cover this per query prompt.
DEFAULT_DEADLINE_SECONDS = 300
#: Archive polling interval: starts short (most searches finish in seconds),
#: grows by POLL_BACKOFF to POLL_MAX_SECONDS.
POLL_FIRST_SECONDS = 1.0
POLL_BACKOFF = 1.5
POLL_MAX_SECONDS = 5.0

PENDING_STATUSES = frozenset({'Queued', 'Processing'})
COMPLETE_STATUSES = frozenset({'Success', 'Cached'})
_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
# SerpAPI's 429 body when the monthly searches are spent ("Your account has run
# out of searches."); the hourly-throughput 429 does not contain it.
_OUT_OF_SEARCHES_MARKER = 'run out of searches'


class SerpApiError(RuntimeError):
    """A SerpAPI search that failed and will not succeed by waiting or retrying."""


class SerpApiQuotaExhaustedError(SerpApiError):
    """The account has no searches left this month; every further search fails until it renews."""


def _retry_wait_seconds(response: requests.Response | None, attempt: int) -> float:
    """Jittered exponential wait before retry ``attempt + 1``, honouring a numeric ``Retry-After``."""
    base = float(min(2 ** attempt, 16))
    if response is not None:
        try:
            retry_after = float(response.headers.get('Retry-After', ''))
        except (TypeError, ValueError):
            retry_after = 0.0
        if retry_after > 0:
            base = min(retry_after, 30.0)
    return base * random.uniform(0.5, 1.5)


def _redacted(text: str, secret: Any) -> str:
    """``text`` with every occurrence of ``secret`` masked.

    The key travels as a query parameter, and ``requests`` puts the full URL
    (``...?q=...&api_key=<key>``) into ``ConnectionError`` messages, which end
    up in logs, the stored result row and the provider's ``last_error``.
    """
    return text.replace(secret, '***') if isinstance(secret, str) and secret else text


def _get_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    """GET ``url`` and return its JSON object, retrying only what a retry can fix.

    Messages never carry ``params['api_key']`` (see ``_redacted``).

    Raises:
        SerpApiQuotaExhaustedError: On the out-of-searches 429.
        SerpApiError: On any other non-retryable status, or when every attempt failed.
    """
    api_key = params.get('api_key')
    last_problem = 'no attempt made'
    for attempt in range(MAX_REQUEST_ATTEMPTS):
        response: requests.Response | None = None
        try:
            response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as error:
            last_problem = _redacted(f'{type(error).__name__}: {error}', api_key)
        else:
            if response.status_code == 200:
                payload = response.json()
                if not isinstance(payload, dict):
                    raise SerpApiError('SerpAPI returned a non-object JSON body')
                return payload
            body = _redacted(response.text, api_key)[:300]
            if response.status_code == 429 and _OUT_OF_SEARCHES_MARKER in body.lower():
                raise _failed(SerpApiQuotaExhaustedError(f'SerpAPI account has run out of searches: {body}'))
            if response.status_code not in _RETRYABLE_STATUS_CODES:
                raise _failed(SerpApiError(f'SerpAPI HTTP {response.status_code}: {body}'))
            last_problem = f'HTTP {response.status_code}: {body}'
        if attempt < MAX_REQUEST_ATTEMPTS - 1:
            wait = _retry_wait_seconds(response, attempt)
            logger.warning(f"[SERPAPI_RETRY] {last_problem[:200]} | attempt {attempt + 1}/{MAX_REQUEST_ATTEMPTS} | waiting {wait:.1f}s")
            time.sleep(wait)
    raise _failed(SerpApiError(f'SerpAPI request failed after {MAX_REQUEST_ATTEMPTS} attempts: {last_problem[:300]}'))


def _failed(error: SerpApiError) -> SerpApiError:
    """Log ``error`` under the ``[SERPAPI_FAILED]`` tag ``scripts/quick-error-check.sh`` counts, and return it."""
    logger.error(f"[SERPAPI_FAILED] {error}")
    return error


def _status(payload: dict[str, Any]) -> str | None:
    metadata = payload.get('search_metadata')
    status = metadata.get('status') if isinstance(metadata, dict) else None
    return status if isinstance(status, str) else None


def _finished(payload: dict[str, Any]) -> dict[str, Any] | None:
    """``payload`` when its search is done, ``None`` while it is still pending.

    ``Success`` with an ``error`` field is a real answer (Google returned no
    results for the query) and is returned, not raised.

    Raises:
        SerpApiError: When SerpAPI reports the search itself as failed.
    """
    status = _status(payload)
    if status in PENDING_STATUSES:
        return None
    if status in COMPLETE_STATUSES:
        return payload
    raise SerpApiError(f"SerpAPI search failed (status {status!r}): {str(payload.get('error', ''))[:300]}")


def serpapi_search(
    api_key: str,
    params: dict[str, Any],
    *,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
) -> dict[str, Any]:
    """One SerpAPI search (any ``engine``) submitted async and read back from the Search Archive.

    Args:
        api_key: The SerpAPI key.
        params: The search parameters (``engine``, ``q``, ...), without ``api_key``/``async``.
        deadline_seconds: How long to wait for a submitted search to finish.

    Returns:
        The finished search's JSON, the same document a synchronous request returns.

    Raises:
        SerpApiQuotaExhaustedError: The account has run out of searches.
        SerpApiError: The search failed, or did not finish by the deadline
            (the message then says "timed out", which provider health classifies
            as a transient timeout).
    """
    submitted = _get_json(SERPAPI_SEARCH_URL, {**params, 'api_key': api_key, 'async': 'true'})
    if (done := _finished(submitted)) is not None:
        return done
    search_id = submitted['search_metadata'].get('id')
    if not isinstance(search_id, str) or not search_id:
        raise SerpApiError('SerpAPI accepted the search but returned no search id')

    started = time.monotonic()
    interval = POLL_FIRST_SECONDS
    while time.monotonic() - started < deadline_seconds:
        time.sleep(interval)
        interval = min(interval * POLL_BACKOFF, POLL_MAX_SECONDS)
        archived = _get_json(SERPAPI_ARCHIVE_URL.format(search_id=search_id), {'api_key': api_key})
        if (done := _finished(archived)) is not None:
            logger.info(f"SerpAPI search {search_id} ready after {time.monotonic() - started:.1f}s")
            return done
    raise _failed(SerpApiError(f'SerpAPI search {search_id} timed out: still pending after {deadline_seconds:.0f}s'))
