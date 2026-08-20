"""
SSRF URL Validator.

Validates URLs are safe for server-side fetching by checking:
- Scheme is http or https only
- Hostname is not a blocked internal hostname
- Resolved IP addresses are not in private/reserved ranges

Returns generic error messages that do not leak resolved IPs or internal topology.
"""

import ipaddress
import logging
import socket
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Networks that must never be fetched server-side.
#
# These are pinned explicitly rather than left entirely to the stdlib so the
# behavior of the ranges we care most about cannot shift under a Python
# upgrade. `_is_ip_blocked` ALSO consults `ipaddress`'s own classification
# properties, which catch considerably more than this list (verified to behave
# identically on 3.12 — the Lambda runtime — and 3.14).
#
# Corrections here relative to the original list (AUDIT-2026-08-19 §2.5):
#   - `fc00::/7` replaces `fd00::/8`, which covered only half of ULA space.
#   - CGNAT, NAT64, benchmarking, multicast and reserved ranges were absent.
#     CGNAT is the ONE range below that the stdlib properties do not flag, so
#     without it a 100.64.0.0/10 address would still pass.
#   - `fd00:ec2::254` (AWS IMDS over IPv6) needs no separate entry: it falls
#     inside `fc00::/7`.
BLOCKED_NETWORKS = [
    ipaddress.ip_network('127.0.0.0/8'),        # Loopback
    ipaddress.ip_network('10.0.0.0/8'),         # Private Class A
    ipaddress.ip_network('172.16.0.0/12'),      # Private Class B
    ipaddress.ip_network('192.168.0.0/16'),     # Private Class C
    ipaddress.ip_network('169.254.0.0/16'),     # Link-local / cloud metadata
    ipaddress.ip_network('0.0.0.0/8'),          # "This" network
    ipaddress.ip_network('100.64.0.0/10'),      # CGNAT (RFC 6598)
    ipaddress.ip_network('192.0.0.0/24'),       # IETF protocol assignments
    ipaddress.ip_network('198.18.0.0/15'),      # Benchmarking (RFC 2544)
    ipaddress.ip_network('224.0.0.0/4'),        # Multicast
    ipaddress.ip_network('240.0.0.0/4'),        # Reserved
    ipaddress.ip_network('::1/128'),            # IPv6 loopback
    ipaddress.ip_network('fc00::/7'),           # IPv6 unique local (full range)
    ipaddress.ip_network('fe80::/10'),          # IPv6 link-local
    ipaddress.ip_network('64:ff9b::/96'),       # NAT64 — an alternate route to IPv4
]

# Stdlib classifications that make an address unsafe to fetch. Broader and
# better maintained than any hand-written list: these already cover 6to4,
# IPv4-mapped IPv6, NAT64, full ULA and every IANA special-purpose range.
_UNSAFE_ADDRESS_PROPERTIES = (
    'is_private',
    'is_loopback',
    'is_link_local',
    'is_multicast',
    'is_reserved',
    'is_unspecified',
)

# Hostnames that are always blocked regardless of DNS resolution
BLOCKED_HOSTNAMES = {
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '169.254.169.254',
}


def _embedded_addresses(addr):
    """Yield ``addr`` plus any IPv4 address wrapped inside an IPv6 form.

    An IPv6 address can carry an IPv4 one: `::ffff:169.254.169.254`
    (IPv4-mapped), `2002:a9fe:a9fe::1` (6to4) and Teredo all encode a v4
    address that the connection ultimately reaches. The stdlib flags the
    wrapper itself in every case we tested, but unwrapping makes the intent
    explicit and covers any wrapper form it classifies less strictly.
    """
    yield addr

    for attribute in ('ipv4_mapped', 'sixtofour'):
        embedded = getattr(addr, attribute, None)
        if embedded is not None:
            yield embedded

    # `teredo` yields a (server, client) pair; both are real v4 endpoints.
    teredo = getattr(addr, 'teredo', None)
    if teredo is not None:
        yield from teredo


def _is_ip_blocked(ip_str: str) -> bool:
    """Check whether an IP address is unsafe to fetch server-side.

    Fails CLOSED. The previous implementation returned ``False`` from
    ``except ValueError``, so any address the parser rejected was treated as
    safe (AUDIT-2026-08-19 §2.5).
    """
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        logger.warning('SSRF blocked: unparseable address from hostname resolution')
        return True

    for candidate in _embedded_addresses(addr):
        if any(getattr(candidate, prop, False) for prop in _UNSAFE_ADDRESS_PROPERTIES):
            return True

        # Compare only within the same address family. `IPv6Address in
        # IPv4Network` returns False *silently*, which is what let an
        # IPv4-mapped address skip every IPv4 rule; the explicit version
        # guard makes that impossible to reintroduce unnoticed.
        for network in BLOCKED_NETWORKS:
            if network.version == candidate.version and candidate in network:
                return True

    return False


def validate_url_safe(url: str) -> tuple[bool, str]:
    """
    Validate that a URL is safe for server-side fetching (SSRF prevention).

    Checks:
    1. URL has http or https scheme
    2. Hostname is not in the blocked hostnames list
    3. All resolved IP addresses are not in private/reserved ranges

    Args:
        url: The URL to validate

    Returns:
        Tuple of (is_safe, error_message). If safe, error_message is empty string.
        Error messages are generic and do not reveal resolved IPs.
    """
    if not url or not isinstance(url, str):
        return False, 'Invalid URL format'

    try:
        parsed = urlparse(url)
    except Exception:
        return False, 'Invalid URL format'

    # Check scheme
    if parsed.scheme not in ('http', 'https'):
        return False, f'URL scheme must be http or https, got: {parsed.scheme or "none"}'

    hostname = parsed.hostname
    if not hostname:
        return False, 'URL must contain a valid hostname'

    # Check blocked hostnames
    hostname_lower = hostname.lower()
    if hostname_lower in BLOCKED_HOSTNAMES:
        return False, 'URL points to a restricted address'

    # If the hostname is already an IP literal, judge it directly rather than
    # handing it to DNS. Catches forms the literal blocklist above cannot
    # enumerate, e.g. `http://[::ffff:169.254.169.254]/` or a decimal-encoded
    # `http://2130706433/`.
    try:
        literal_ip = ipaddress.ip_address(hostname_lower)
    except ValueError:
        literal_ip = None

    if literal_ip is not None and _is_ip_blocked(str(literal_ip)):
        logger.warning('SSRF blocked: IP literal in restricted range')
        return False, 'URL points to a restricted address'

    # Resolve hostname and check all returned IPs
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False, 'Could not resolve hostname'
    except Exception:
        return False, 'Could not resolve hostname'

    if not addr_infos:
        return False, 'Could not resolve hostname'

    for addr_info in addr_infos:
        ip_str = addr_info[4][0]
        if _is_ip_blocked(ip_str):
            logger.warning(f'SSRF blocked: {hostname} resolved to private/reserved IP')
            return False, 'URL points to a restricted address'

    return True, ''



# -----------------------------------------------------------------------------
# Accepted risk: DNS rebinding (time-of-check to time-of-use)
#
# `validate_url_safe` resolves the hostname and checks the resulting IPs, then
# the HTTP client performs its OWN resolution when it connects. A nameserver
# under an attacker's control can answer with a public IP for the check and a
# private one for the connection.
#
# A `resolve_and_validate` helper used to live here, intended to be paired with
# a requests adapter that pins the connection to the already-validated IP. It
# had zero production callers, so it advertised protection that nothing
# received (AUDIT-2026-08-19 §2.5). It has been removed rather than left as
# misleading dead code.
#
# This gap is knowingly accepted. Pinning the IP while keeping SNI and
# certificate validation correct is easy to get subtly wrong, and the remaining
# exposure is narrow: exploiting it requires controlling DNS for a domain AND
# winning a timing race, and the only server-side fetchers are the keyword
# research routes. Revisit this if a route ever fetches URLs supplied by an
# untrusted (non-authenticated) source, or if these Lambdas are placed in a VPC
# where internal services become reachable.
# -----------------------------------------------------------------------------
