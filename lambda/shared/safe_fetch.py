"""
SSRF-safe HTTP fetching: follow redirects, but validate every hop.

`allow_redirects=True` silently defeats URL validation. The pattern it produces
is: validate the URL the caller supplied, then hand it to `requests`, which
chases the redirect chain to wherever it leads without anyone re-checking.
A caller-supplied `https://attacker.example/page` passes validation, answers
`301 Location: http://127.0.0.1:9001/...`, and the body of that internal
response comes back (AUDIT-2026-08-19 §2.6).

The fix is NOT to stop following redirects — legitimate callers depend on it,
notably Gemini's `vertexaisearch.cloud.google.com` wrappers, which have to be
followed to recover the real citation domain. The fix is to follow them
ourselves, one hop at a time, revalidating each destination.

This lives apart from `url_validator` so that module stays dependency-free
(it is imported on cold-start paths that never make HTTP requests).
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

from shared.url_validator import validate_url_safe

logger = logging.getLogger(__name__)

# Redirect chains longer than this are treated as hostile or broken. Browsers
# use ~20; a legitimate citation wrapper needs one or two.
MAX_REDIRECT_HOPS = 5

# Statuses that carry a `Location` we should follow. 303 is included because
# it is a redirect even though it mandates a method change for non-GET verbs.
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


def fetch_following_validated_redirects(
    url: str,
    *,
    method: str = 'GET',
    timeout: float = 5,
    headers: dict[str, str] | None = None,
    max_hops: int = MAX_REDIRECT_HOPS,
) -> tuple[Any | None, str | None, str]:
    """
    Fetch ``url``, validating the URL at every redirect hop.

    Args:
        url: The starting URL. Validated before the first request.
        method: HTTP method, preserved across hops. Use ``'HEAD'`` when only
            the final URL is wanted and the body is irrelevant.
        timeout: Per-request timeout in seconds. Note this bounds each hop, so
            worst-case wall time is ``timeout * (max_hops + 1)``.
        headers: Optional request headers, sent on every hop.
        max_hops: Maximum redirects to follow before giving up.

    Returns:
        ``(response, final_url, error)``. On success ``error`` is empty and both
        other values are set. On refusal or failure ``response`` and
        ``final_url`` are ``None`` and ``error`` holds a generic message safe to
        return to a caller — it never leaks a resolved IP or internal hostname.
    """
    current_url = url

    for _hop in range(max_hops + 1):
        is_safe, validation_error = validate_url_safe(current_url)
        if not is_safe:
            # Deliberately does not echo `current_url`: on a later hop that
            # value is attacker-chosen and would confirm what is reachable.
            logger.warning('Blocked redirect chain: %s', validation_error)
            return None, None, validation_error

        try:
            response = requests.request(
                method,
                current_url,
                timeout=timeout,
                headers=headers,
                allow_redirects=False,
            )
        except requests.RequestException as error:
            logger.warning('Request failed for validated URL: %s', type(error).__name__)
            return None, None, 'Could not fetch the requested URL'

        if response.status_code not in _REDIRECT_STATUSES:
            return response, current_url, ''

        location = response.headers.get('Location')
        if not location:
            # A redirect status with no target: nothing further to follow, so
            # treat this response as final rather than erroring.
            return response, current_url, ''

        # `Location` may be relative; resolve it against the current URL the
        # same way a browser would, so the next hop is validated as an
        # absolute URL.
        current_url = urljoin(current_url, location)

    logger.warning('Redirect chain exceeded %d hops', max_hops)
    return None, None, 'Too many redirects'


def host_matches(url: str, allowed_hosts: frozenset[str]) -> bool:
    """
    Return True iff ``url``'s host is exactly one of ``allowed_hosts``.

    Case-insensitive exact match on the hostname — never a substring or suffix
    test, so ``vertexaisearch.cloud.google.com.attacker.example`` does not match
    ``vertexaisearch.cloud.google.com``.
    """
    try:
        hostname = urlparse(url).hostname
    except ValueError:
        return False

    return hostname is not None and hostname.lower() in allowed_hosts


__all__ = [
    'MAX_REDIRECT_HOPS',
    'fetch_following_validated_redirects',
    'host_matches',
]
