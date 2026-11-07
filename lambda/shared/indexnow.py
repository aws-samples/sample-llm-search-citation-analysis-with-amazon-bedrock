"""IndexNow: tell search engines which of the brand's pages changed, and check the key file they verify.

* **Hosts**: only http(s) URLs on an owned domain or one of its subdomains are sent; others are skipped and
  reported. The fragment is dropped, duplicates removed, and the URLs grouped per host: an IndexNow request
  names one host, and each host must serve the key file itself.
* **Key file check** (free, through the audit's SSRF-safe fetcher, no redirect followed):
  ``https://<host>/<key>.txt`` must answer 2xx with the key alone. 404/410 is ``missing``; a redirect to the same
  file on another host (a bare domain forwarding to ``www.``) is ``moved``, any other redirect ``redirects``;
  another answer or a timeout is ``unknown`` (a bot wall may hide a good file); no connection is
  ``unreachable``. ``missing``, ``wrong_content``, ``redirects`` and ``moved`` stop that host with the fix to
  make; ``unknown`` and ``unreachable`` let the submission go ahead, since the engines fetch the file
  themselves.
* **Engines**: engines that take part in IndexNow share every accepted submission, so one acceptance is
  enough. Bing goes first, then Yandex, then Yep; the next one is tried only after a network error, a 429 or a
  5xx (some engines rate-limit shared cloud addresses). Any other answer is final.

Every request fits the caller's time: a host that cannot get a request in before the API's deadline is
reported as not sent, and submitting it again is free.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import requests

from shared.audit_fetch import TEXT_ACCEPT, fetch_once
from shared.audit_urls import host_of
from shared.dataforseo_client import remaining_deadline_s
from shared.kpi_engine import is_owned_domain, normalize_domain
from shared.log_safety import log_text

logger = logging.getLogger(__name__)

ENGINES: tuple[tuple[str, str], ...] = (
    ('bing', 'https://www.bing.com/indexnow'),
    ('yandex', 'https://yandex.com/indexnow'),
    ('yep', 'https://indexnow.yep.com/indexnow'),
)
MAX_URLS = 10_000
MAX_URL_CHARS = 2048
REQUEST_TIMEOUT_S = 10.0
KEY_FILE_TIMEOUT_S = 6.0
MAX_KEY_FILE_BYTES = 64 * 1024
MIN_REQUEST_BUDGET_S = 1.5
"""A request with less time left than this before the deadline is not sent."""

KeyFileStatus = Literal['found', 'missing', 'wrong_content', 'redirects', 'moved', 'unreachable', 'unknown']
_TIMEOUT_ERRORS = ('Timeout', 'ReadTimeout', 'ConnectTimeout')


def key_file_url(host: str, key: str) -> str:
    return f'https://{host}/{key}.txt'


def _budget(timeout_s: float) -> float | None:
    """``timeout_s`` capped to the caller's deadline, or ``None`` when too little time is left to send."""
    remaining = remaining_deadline_s()
    if remaining is None:
        return timeout_s
    return min(timeout_s, remaining) if remaining >= MIN_REQUEST_BUDGET_S else None


def _redirect_status(location: str | None, host: str, key: str) -> KeyFileStatus:
    target = urlsplit(location or '')
    moved = bool(target.hostname) and target.hostname != host and target.path == f'/{key}.txt'
    return 'moved' if moved else 'redirects'


def check_key_file(host: str, key: str) -> KeyFileStatus:
    """Whether ``host`` serves the key file (see the module docstring for each status)."""
    timeout_s = _budget(KEY_FILE_TIMEOUT_S)
    if timeout_s is None:
        return 'unknown'
    result = fetch_once(key_file_url(host, key), max_bytes=MAX_KEY_FILE_BYTES, accept=TEXT_ACCEPT, timeout_s=timeout_s)
    if result.status == 0:
        return 'unknown' if result.error in _TIMEOUT_ERRORS else 'unreachable'
    if result.status in {404, 410}:
        return 'missing'
    if 300 <= result.status < 400:
        return _redirect_status(result.location, host, key)
    if not 200 <= result.status < 300:
        return 'unknown'
    return 'found' if not result.truncated and result.text().strip() == key else 'wrong_content'


def key_file_problem(status: KeyFileStatus, host: str) -> str | None:
    """The fix to make before engines will accept submissions for ``host``, or ``None``."""
    if status == 'missing':
        return f'No key file at the root of https://{host}. Upload it there, then try again.'
    if status == 'wrong_content':
        return f'The key file on https://{host} should contain only the key.'
    if status in {'redirects', 'moved'}:
        return f'The key file on https://{host} redirects. Upload it to https://{host} itself.'
    return None


# ---------------------------------------------------------------------------
# URL grouping
# ---------------------------------------------------------------------------

def owning_domain(host: str, domains: Iterable[str]) -> str | None:
    """The owned domain ``host`` is, or is a subdomain of (the longest match), or ``None``."""
    bare = normalize_domain(host) or ''
    matches = [domain for domain in domains if is_owned_domain(bare, [domain])]
    return max(matches, key=len) if matches else None


def _clean_url(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > MAX_URL_CHARS:
        return None
    try:
        parts = urlsplit(raw.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in {'http', 'https'} or not parts.hostname:
        return None
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or '/', parts.query, ''))


@dataclass
class UrlGroups:
    """Submitted URLs grouped per owned host (in first-seen order), and the ones skipped."""

    by_host: dict[str, list[str]] = field(default_factory=dict)
    domain_of: dict[str, str] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)


def group_urls(urls: Iterable[object], domains: Iterable[str]) -> UrlGroups:
    owned = list(domains)
    groups = UrlGroups()
    for raw in urls:
        url = _clean_url(raw)
        host = host_of(url) if url else ''
        domain = owning_domain(host, owned) if host else None
        if url is None or domain is None:
            groups.skipped.append(str(raw)[:MAX_URL_CHARS])
            continue
        hosted = groups.by_host.setdefault(host, [])
        if url not in hosted:
            hosted.append(url)
        groups.domain_of[host] = domain
    return groups


# ---------------------------------------------------------------------------
# Engines
# ---------------------------------------------------------------------------

def _post(endpoint: str, body: bytes, timeout_s: float) -> int | None:
    """POST ``body``; the engine's status, or ``None`` when it did not answer (network error or timeout)."""
    try:
        response = requests.post(
            endpoint, data=body, timeout=timeout_s, allow_redirects=False,
            headers={'Content-Type': 'application/json; charset=utf-8'},
        )
    except requests.RequestException as error:
        logger.warning('indexnow.engine-unreachable endpoint=%s error=%s', endpoint, type(error).__name__)
        return None
    if not 200 <= response.status_code < 300:
        logger.warning('indexnow.engine-refused endpoint=%s status=%s detail=%s', endpoint, response.status_code,
                       log_text(response.text[:200]))
    return response.status_code


#: The transport; tests replace this one attribute.
send: Callable[[str, bytes, float], int | None] = _post


def describe(status: int | None, url_count: int, host: str) -> tuple[str, str]:
    """``(outcome, message)`` of an engine's answer; ``outcome`` is ``submitted`` or ``failed``."""
    urls = f"{url_count} URL{'' if url_count == 1 else 's'}"
    if status is None:
        return 'failed', "IndexNow didn't respond. Try again later."
    if status == 200:
        return 'submitted', f'Submitted {urls}.'
    if status == 202:
        return 'submitted', f'Submitted {urls}. Search engines will verify the key file on https://{host} first.'
    if status == 403:
        return 'failed', f"The key wasn't accepted. Check that the key file on https://{host} contains only the key."
    if status == 422:
        return 'failed', f'The URLs do not belong to https://{host} or the key does not match it.'
    if status == 429:
        return 'failed', 'Search engines are refusing submissions right now. Try again later, and only submit pages that changed.'
    return 'failed', f'IndexNow returned HTTP {status}.'


def _moves_on(status: int | None) -> bool:
    return status is None or status == 429 or status >= 500


def submit_to_engines(host: str, key: str, urls: list[str]) -> list[dict[str, Any]]:
    """Each engine's answer, in order, until one gives a final answer."""
    body = json.dumps({'host': host, 'key': key, 'urlList': urls}).encode('utf-8')
    answers: list[dict[str, Any]] = []
    for engine, endpoint in ENGINES:
        timeout_s = _budget(REQUEST_TIMEOUT_S)
        if timeout_s is None:
            break
        status = send(endpoint, body, timeout_s)
        answers.append({'engine': engine, 'http_status': status, 'message': describe(status, len(urls), host)[1]})
        if not _moves_on(status):
            break
    return answers


def submit_host(host: str, key: str, urls: list[str]) -> dict[str, Any]:
    """Check ``host``'s key file, then submit ``urls``: ``{host, url_count, status, message, key_file, engines}``."""
    base: dict[str, Any] = {'host': host, 'url_count': len(urls)}
    key_file = check_key_file(host, key)
    problem = key_file_problem(key_file, host)
    if problem is not None:
        return {**base, 'status': 'failed', 'message': problem, 'key_file': key_file, 'engines': []}
    engines = submit_to_engines(host, key, urls)
    if not engines:
        return {**base, 'status': 'not_sent', 'key_file': key_file, 'engines': [],
                'message': 'Not sent: the request ran out of time. Submit these URLs again.'}
    outcome, message = describe(engines[-1]['http_status'], len(urls), host)
    return {**base, 'status': outcome, 'message': message, 'key_file': key_file, 'engines': engines}


def submit(groups: UrlGroups, keys: Mapping[str, str]) -> list[dict[str, Any]]:
    """Submit each host of ``groups`` with the key of its owned domain (``keys``: domain -> key)."""
    results = []
    for host, urls in groups.by_host.items():
        key = keys.get(groups.domain_of[host])
        if key is None:
            results.append({
                'host': host, 'url_count': len(urls), 'status': 'failed', 'key_file': None, 'engines': [],
                'message': f'Create the IndexNow key for {groups.domain_of[host]} first.',
            })
            continue
        results.append(submit_host(host, key, urls))
    return results
