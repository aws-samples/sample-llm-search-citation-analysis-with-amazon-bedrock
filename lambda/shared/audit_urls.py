"""
URL rules of the site audit: normalization, same-origin, crawlability and the start URL.

* **Normalization** (``normalize_url``): resolve against the page, http(s) only, drop the fragment, lower-case
  the host, drop the default port, sort the query parameters and *keep* the trailing slash: stripping it turns
  ``/path`` <-> ``/path/`` server redirects into a loop the crawler would chase forever.
* **Same origin** (``is_same_origin``): the same host or its ``www.`` twin, on the same scheme and port, or the
  http:80 / https:443 pair of one host (a site that upgrades to https is still one site).
* **Crawlable** (``is_crawlable``): http(s), no ``user:pass@``, port 80 or 443, and a host that is neither an
  internal name nor a private IP literal. Discovered links are judged without DNS (one lookup per link would
  dominate the crawl); every request still resolves and checks its address before connecting
  (``shared.audit_fetch``).
* **Start URL** (``start_url_for``): ``https://`` is added when no scheme is given, and the host must be one of
  the brand's owned domains (``first_party_domains``) or a subdomain: the audit only crawls the brand's own site.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from shared.kpi_engine import is_owned_domain, normalize_domain
from shared.url_validator import BLOCKED_HOSTNAMES, _is_blocked_ip_literal

ALLOWED_SCHEMES = ('http', 'https')
DEFAULT_PORTS = {'http': 80, 'https': 443}
BLOCKED_HOSTS = frozenset({*BLOCKED_HOSTNAMES, 'metadata.google.internal', 'metadata', '100.100.100.200'})
BLOCKED_HOST_SUFFIXES = ('.localhost', '.local', '.localdomain', '.internal', '.home.arpa')
MAX_URL_CHARS = 2048
_NUMERIC_HOST = re.compile(r'(0x[0-9a-f]*|[0-9]+)(\.(0x[0-9a-f]*|[0-9]+))*')
_DOTTED_QUAD = re.compile(r'(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}')


class StartUrlError(ValueError):
    """The start URL cannot be audited; ``str(error)`` is a message safe to show."""


def _port(scheme: str, port: int | None) -> int:
    return DEFAULT_PORTS[scheme] if port is None else port


def _sorted_query(query: str) -> str:
    if not query:
        return ''
    return urlencode(sorted(parse_qsl(query, keep_blank_values=True)), doseq=True)


def normalize_url(url: str, base: str | None = None) -> str | None:
    """The canonical form of ``url`` (resolved against ``base``), or ``None`` when it is not a usable http(s) URL."""
    if not url.strip() or len(url) > MAX_URL_CHARS:
        return None
    try:
        parts = urlsplit(urljoin(base, url.strip()) if base else url.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    host = (parts.hostname or '').lower().rstrip('.')
    if scheme not in ALLOWED_SCHEMES or not host:
        return None
    netloc = host if ':' not in host else f'[{host}]'
    if port is not None and port != DEFAULT_PORTS[scheme]:
        netloc = f'{netloc}:{port}'
    if parts.username or parts.password:
        netloc = f'{parts.username or ""}:{parts.password or ""}@{netloc}'
    return urlunsplit((scheme, netloc, parts.path or '/', _sorted_query(parts.query), ''))


def _bare_host(host: str) -> str:
    return host.removeprefix('www.')


def is_same_origin(url: str, other: str) -> bool:
    """Whether ``url`` and ``other`` belong to one site (host or ``www.`` twin; same scheme and port, or http->https)."""
    try:
        first, second = urlsplit(url), urlsplit(other)
        first_port, second_port = first.port, second.port
    except ValueError:
        return False
    if first.scheme not in ALLOWED_SCHEMES or second.scheme not in ALLOWED_SCHEMES:
        return False
    if _bare_host((first.hostname or '').lower()) != _bare_host((second.hostname or '').lower()):
        return False
    first_key = (first.scheme, _port(first.scheme, first_port))
    second_key = (second.scheme, _port(second.scheme, second_port))
    default_pair = {('http', 80), ('https', 443)}
    return first_key == second_key or {first_key, second_key} == default_pair


def is_blocked_host(host: str) -> bool:
    """Whether ``host`` is an internal name or a private / reserved IP literal (no DNS lookup).

    A host made only of numeric labels that is not a plain public dotted quad (``2130706433``, ``0x7f.1``,
    ``0177.0.0.1``) is refused too: resolvers read those as IP addresses, and no real domain looks like that.
    """
    name = host.lower().strip('[]').rstrip('.')
    if not name or name in BLOCKED_HOSTS or name.endswith(BLOCKED_HOST_SUFFIXES):
        return True
    if _NUMERIC_HOST.fullmatch(name) and not _DOTTED_QUAD.fullmatch(name):
        return True
    return _is_blocked_ip_literal(name)


def is_crawlable(url: str) -> bool:
    """http(s), no credentials, port 80/443 and not an internal host: safe to queue (the fetch checks DNS)."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme not in ALLOWED_SCHEMES or parts.username or parts.password:
        return False
    if port is not None and port not in DEFAULT_PORTS.values():
        return False
    return bool(parts.hostname) and not is_blocked_host(parts.hostname or '')


def host_of(url: str) -> str:
    """The lower-case host of ``url`` (``''`` when it has none)."""
    try:
        return (urlsplit(url).hostname or '').lower()
    except ValueError:
        return ''


def origin_of(url: str) -> str:
    """``scheme://host[:port]`` of a normalized URL."""
    parts = urlsplit(url)
    return f'{parts.scheme}://{parts.netloc}'


def path_and_query(url: str) -> str:
    """The path (``/`` when empty) plus ``?query`` of ``url``: what robots.txt rules match against."""
    parts = urlsplit(url)
    path = parts.path or '/'
    return f'{path}?{parts.query}' if parts.query else path


def url_hash(url: str) -> str:
    """A stable key for ``url`` (URLs can exceed DynamoDB's 1 KB sort-key limit)."""
    return hashlib.sha256(url.encode('utf-8')).hexdigest()[:40]


def start_url_for(raw: str, owned_domains: Iterable[str]) -> str:
    """The normalized start URL of an audit; raises ``StartUrlError`` unless it is on an owned domain."""
    text = raw.strip()
    if not text:
        raise StartUrlError('start_url is required')
    if '://' not in text:
        text = f'https://{text}'
    url = normalize_url(text)
    if url is None or not is_crawlable(url):
        raise StartUrlError('start_url must be a public http(s) address on port 80 or 443')
    domains = list(owned_domains)
    if not domains:
        raise StartUrlError('Add the brand\'s own domains in Settings > Brand Tracking before running an audit')
    if not is_owned_domain(normalize_domain(host_of(url)) or '', domains):
        raise StartUrlError('start_url must be on one of the brand\'s own domains')
    return url

