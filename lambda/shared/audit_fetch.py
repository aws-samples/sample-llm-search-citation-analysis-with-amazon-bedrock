"""
HTTP fetches of the site audit, guarded against server-side request forgery.

Every request:

* goes only to a crawlable URL (``shared.audit_urls.is_crawlable``: http(s), port 80/443, no credentials, no
  internal host) whose name resolves only to public addresses (``shared.url_validator.validate_url_safe``);
* checks the address the socket actually connected to before reading a byte of the body, so a name that
  answers with a public address for the check and a private one for the connection is still refused;
* never follows a redirect by itself (``allow_redirects=False``): the crawler records every hop as its own
  page, and ``fetch_following`` re-validates each hop (at most ``MAX_REDIRECT_HOPS``) for robots.txt,
  sitemaps and llms.txt;
* reads at most ``max_bytes`` of body (HTML 1 MiB, robots.txt 500 KiB, sitemaps 10 MiB) and gives up after
  ``timeout_s`` for the whole response, sends no cookies or credentials, and names itself with ``USER_AGENT``.

``_send`` is the transport (tests patch it); it never raises: a failure is a status-0 ``FetchResult``.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

import requests

from shared.audit_urls import is_crawlable, normalize_url
from shared.url_validator import _is_ip_blocked, validate_url_safe

logger = logging.getLogger(__name__)

#: robots.txt product token of the audit crawler; site owners allow or block it by this name.
CRAWLER_NAME = 'CitationAnalysisAudit'
USER_AGENT = f'{CRAWLER_NAME}/1.0'
HTML_ACCEPT = 'text/html,application/xhtml+xml'
TEXT_ACCEPT = 'text/plain,text/markdown,*/*;q=0.5'
XML_ACCEPT = 'application/xml,text/xml,*/*;q=0.5'

MAX_HTML_BYTES = 1024 * 1024
MAX_ROBOTS_BYTES = 500 * 1024
MAX_SITEMAP_BYTES = 10 * 1024 * 1024
MAX_LLMS_TXT_BYTES = 1024 * 1024
MAX_REDIRECT_HOPS = 5
PAGE_TIMEOUT_S = 15.0
_READ_CHUNK_BYTES = 64 * 1024
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


@dataclass(frozen=True)
class RawResponse:
    """What the transport read: status, lower-cased headers and at most ``max_bytes`` of body."""

    status: int
    headers: Mapping[str, str]
    body: bytes
    truncated: bool = False


@dataclass(frozen=True)
class FetchResult:
    """One HTTP response (no redirect followed); ``status`` 0 with ``error`` set when no response was read."""

    url: str
    status: int
    headers: Mapping[str, str] = field(default_factory=dict)
    body: bytes = b''
    truncated: bool = False
    elapsed_ms: int = 0
    error: str = ''

    @property
    def location(self) -> str | None:
        """The absolute, normalized redirect target of a 3xx answer, or ``None``."""
        target = self.headers.get('location') if self.status in REDIRECT_STATUSES else None
        return normalize_url(target, self.url) if target else None

    @property
    def content_type(self) -> str:
        return self.headers.get('content-type', '').lower()

    def text(self) -> str:
        """The body decoded as UTF-8 (invalid bytes replaced)."""
        return self.body.decode('utf-8', errors='replace')


class BlockedAddressError(Exception):
    """The connection reached an address the audit must never fetch from."""


def _peer_address(response: Any) -> str | None:
    """The IP address the response's socket is connected to, or ``None`` when it cannot be read."""
    connection = getattr(getattr(response, 'raw', None), 'connection', None)
    sock = getattr(connection, 'sock', None)
    try:
        peer = sock.getpeername() if sock is not None else None
    except OSError:
        return None
    return str(peer[0]) if peer else None


def _read_capped(response: Any, max_bytes: int, deadline: float) -> tuple[bytes, bool]:
    body = bytearray()
    for chunk in response.iter_content(chunk_size=_READ_CHUNK_BYTES):
        body.extend(chunk)
        if len(body) > max_bytes:
            return bytes(body[:max_bytes]), True
        if time.monotonic() > deadline:
            raise requests.Timeout('body read exceeded the fetch timeout')
    return bytes(body), False


def _send(url: str, headers: Mapping[str, str], timeout_s: float, max_bytes: int) -> RawResponse:
    """GET ``url`` without following redirects; raises ``BlockedAddressError`` or ``requests.RequestException``."""
    deadline = time.monotonic() + timeout_s
    response = requests.get(url, headers=dict(headers), timeout=timeout_s, allow_redirects=False, stream=True)
    try:
        peer = _peer_address(response)
        # Fail closed: a connection whose peer cannot be read is not trusted.
        if peer is None or _is_ip_blocked(peer):
            raise BlockedAddressError(url)
        body, truncated = _read_capped(response, max_bytes, deadline)
        lowered = {key.lower(): value for key, value in response.headers.items()}
        return RawResponse(status=response.status_code, headers=lowered, body=body, truncated=truncated)
    finally:
        response.close()


def fetch_once(url: str, *, max_bytes: int, accept: str = HTML_ACCEPT, timeout_s: float = PAGE_TIMEOUT_S) -> FetchResult:
    """One GET of ``url`` (no redirect followed), refused before connecting when the address is not public."""
    if not is_crawlable(url):
        return FetchResult(url=url, status=0, error='not_crawlable')
    safe, _reason = validate_url_safe(url)
    if not safe:
        return FetchResult(url=url, status=0, error='blocked_address')
    headers = {'User-Agent': USER_AGENT, 'Accept': accept}
    started = time.monotonic()
    try:
        raw = _send(url, headers, timeout_s, max_bytes)
    except BlockedAddressError:
        logger.warning('Audit fetch refused: the connection reached a restricted address')
        return FetchResult(url=url, status=0, error='blocked_address')
    except requests.RequestException as error:
        elapsed = int((time.monotonic() - started) * 1000)
        return FetchResult(url=url, status=0, elapsed_ms=elapsed, error=type(error).__name__)
    elapsed = int((time.monotonic() - started) * 1000)
    return FetchResult(
        url=url, status=raw.status, headers=raw.headers, body=raw.body, truncated=raw.truncated, elapsed_ms=elapsed,
    )


def fetch_following(
    url: str,
    *,
    max_bytes: int,
    accept: str,
    timeout_s: float,
    allow_hop: Callable[[str], bool] = is_crawlable,
) -> FetchResult:
    """GET ``url`` following at most ``MAX_REDIRECT_HOPS`` redirects, each hop accepted by ``allow_hop`` and re-validated.

    The answer's ``url`` is the final URL. A refused hop or a longer chain is a status-0 result.
    """
    current = url
    deadline = time.monotonic() + timeout_s
    for _hop in range(MAX_REDIRECT_HOPS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return FetchResult(url=current, status=0, error='Timeout')
        result = fetch_once(current, max_bytes=max_bytes, accept=accept, timeout_s=remaining)
        target = result.location
        if target is None:
            return result
        if not allow_hop(target):
            return FetchResult(url=target, status=0, error='redirect_refused')
        current = urljoin(current, target)
    return FetchResult(url=current, status=0, error='too_many_redirects')
