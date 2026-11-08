"""The target of a backlinks lookup: a domain, its subdomains, a subfolder or one exact page.

``backlinks_target(text, scope)`` turns what the user typed into what DataForSEO's Backlinks API is sent, and
refuses an unusable target before any paid call:

* The text is trimmed and given ``https://`` when it has no scheme; only ``http`` and ``https`` are accepted, and a
  URL with embedded credentials is refused.
* The host is lower-cased (an internationalized name is sent in its ASCII ``xn--`` form) and must look like a
  registrable domain: at least one dot, only ``[a-z0-9.-]``, labels of 1-63 characters that neither start nor end
  with a hyphen, and an alphabetic (or ``xn--``) top-level label, so an IP address or ``localhost`` is refused.
  DataForSEO bills a host such as ``my_site.com`` and then fails it, hence the strict charset.
* ``hostname`` drops a leading ``www.``; the path drops trailing slashes, the query and the fragment (``""`` for
  the root).
* Without a scope, a root input means ``subdomains`` and an input with a path means ``subfolder``; ``subfolder``
  without a path is refused. ``page`` is accepted as another name for ``exact_url``.
* An exact page keeps ``www.`` and an explicit ``http://`` (DataForSEO matches page URLs exactly) and refuses a
  query string or fragment instead of silently dropping it, since that would look up a different page.

| scope        | ``api_target``                | ``include_subdomains`` | ``path``  |
|--------------|-------------------------------|------------------------|-----------|
| subdomains   | hostname                      | true                   | ``""``    |
| domain       | hostname                      | false                  | ``""``    |
| subfolder    | hostname                      | false                  | ``/blog`` |
| exact_url    | ``https://www.host/page``     | true (ignored)         | ``""``    |

There is no public-suffix list in the Lambda layer, so a made-up top-level domain with letters only passes the
check; DataForSEO then answers it with an empty profile.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

Scope = Literal['domain', 'subdomains', 'subfolder', 'exact_url']
SCOPES: tuple[Scope, ...] = ('exact_url', 'subfolder', 'domain', 'subdomains')
LEGACY_SCOPE_ALIASES: dict[str, Scope] = {'page': 'exact_url'}
MAX_TARGET_CHARS = 2048

INVALID_DOMAIN_MESSAGE = 'Enter a valid domain like example.com'
EMPTY_TARGET_MESSAGE = 'Enter a domain or URL'
CREDENTIALS_MESSAGE = 'URLs with embedded credentials are not supported'
SUBFOLDER_NEEDS_PATH_MESSAGE = 'Add a path to use Subfolder (e.g. example.com/blog)'
PAGE_QUERY_MESSAGE = 'Page URLs with query strings or fragments are not supported'

_SCHEME = re.compile(r'^[a-zA-Z][a-zA-Z\d+.-]*://')
_HOST_CHARSET = re.compile(r'^[a-z\d.-]+$')
_LABEL = re.compile(r'^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$')
_TOP_LEVEL = re.compile(r'^(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$')
_MAX_HOST_CHARS = 253


class InvalidTargetError(ValueError):
    """The text is not a usable backlinks target; the message is fit to show the user."""


@dataclass(frozen=True)
class BacklinksTarget:
    """A target resolved for the Backlinks API."""

    scope: Scope
    api_target: str
    """What DataForSEO is sent as ``target``: the hostname, or the absolute page URL for ``exact_url``."""
    include_subdomains: bool
    path: str
    """The subfolder path (``/blog``) driving the URL filters; ``""`` for every other scope."""
    hostname: str
    """The lower-case host without a leading ``www.``."""
    display: str
    """What the page shows: the hostname, ``hostname + path`` for a subfolder, the page URL for an exact page."""


def resolve_scope(scope: str | None) -> Scope | None:
    """``scope`` as one of ``SCOPES`` (``page`` = ``exact_url``); ``None`` when absent. Raises on anything else."""
    if scope is None or scope == '':
        return None
    resolved = LEGACY_SCOPE_ALIASES.get(scope, scope)
    for known in SCOPES:
        if known == resolved:
            return known
    raise InvalidTargetError(f'scope must be one of {", ".join(SCOPES)}')


def _ascii_host(host: str) -> str:
    """``host`` lower-cased in its ASCII (punycode) form; ``""`` when it cannot be encoded."""
    try:
        return host.encode('idna').decode('ascii').lower()
    except UnicodeError:
        return ''


def is_registrable_host(host: str) -> bool:
    """Whether ``host`` (lower-case ASCII) looks like a registrable domain DataForSEO accepts."""
    if not host or len(host) > _MAX_HOST_CHARS or '.' not in host or not _HOST_CHARSET.match(host):
        return False
    labels = host.split('.')
    return all(_LABEL.match(label) for label in labels) and bool(_TOP_LEVEL.match(labels[-1]))


def _normalized_path(path: str) -> str:
    return path.rstrip('/')


@dataclass(frozen=True)
class _ParsedInput:
    url_hostname: str
    """Lower-case host as entered, ``www.`` kept (exact page URLs)."""
    hostname: str
    path: str


def _parse(text: str) -> _ParsedInput:
    with_scheme = text if _SCHEME.match(text) else f'https://{text}'
    try:
        parts = urlsplit(with_scheme)
        raw_host = parts.hostname or ''
    except ValueError as exc:
        raise InvalidTargetError(INVALID_DOMAIN_MESSAGE) from exc
    if parts.scheme.lower() not in ('http', 'https'):
        raise InvalidTargetError(INVALID_DOMAIN_MESSAGE)
    if parts.username or parts.password:
        raise InvalidTargetError(CREDENTIALS_MESSAGE)
    url_hostname = _ascii_host(raw_host.rstrip('.'))
    hostname = url_hostname.removeprefix('www.')
    if not is_registrable_host(hostname):
        raise InvalidTargetError(INVALID_DOMAIN_MESSAGE)
    return _ParsedInput(url_hostname=url_hostname, hostname=hostname, path=_normalized_path(parts.path))


def _exact_page(text: str, parsed: _ParsedInput) -> BacklinksTarget:
    if '?' in text or '#' in text:
        raise InvalidTargetError(PAGE_QUERY_MESSAGE)
    protocol = 'http' if text.lower().startswith('http://') else 'https'
    page_url = f'{protocol}://{parsed.url_hostname}{parsed.path or "/"}'
    return BacklinksTarget(
        scope='exact_url', api_target=page_url, include_subdomains=True, path='', hostname=parsed.hostname,
        display=page_url,
    )


def backlinks_target(text: str, scope: str | None = None) -> BacklinksTarget:
    """The Backlinks API target of ``text`` in ``scope`` (the implied scope when ``None``); raises ``InvalidTargetError``."""
    trimmed = text.strip()
    if not trimmed:
        raise InvalidTargetError(EMPTY_TARGET_MESSAGE)
    if len(trimmed) > MAX_TARGET_CHARS:
        raise InvalidTargetError(f'A target has at most {MAX_TARGET_CHARS} characters')
    requested = resolve_scope(scope)
    parsed = _parse(trimmed)
    if requested == 'subfolder' and not parsed.path:
        raise InvalidTargetError(SUBFOLDER_NEEDS_PATH_MESSAGE)
    resolved: Scope = requested or ('subfolder' if parsed.path else 'subdomains')
    if resolved == 'exact_url':
        return _exact_page(trimmed, parsed)
    path = parsed.path if resolved == 'subfolder' else ''
    return BacklinksTarget(
        scope=resolved, api_target=parsed.hostname, include_subdomains=resolved == 'subdomains', path=path,
        hostname=parsed.hostname, display=f'{parsed.hostname}{path}',
    )
