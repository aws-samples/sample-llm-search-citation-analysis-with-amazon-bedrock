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
from typing import Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Private and reserved IP networks that must never be fetched server-side
BLOCKED_NETWORKS = [
    ipaddress.ip_network('127.0.0.0/8'),       # Loopback
    ipaddress.ip_network('10.0.0.0/8'),         # Private Class A
    ipaddress.ip_network('172.16.0.0/12'),      # Private Class B
    ipaddress.ip_network('192.168.0.0/16'),     # Private Class C
    ipaddress.ip_network('169.254.0.0/16'),     # Link-local / metadata
    ipaddress.ip_network('0.0.0.0/8'),          # "This" network
    ipaddress.ip_network('::1/128'),            # IPv6 loopback
    ipaddress.ip_network('fd00::/8'),           # IPv6 unique local
    ipaddress.ip_network('fe80::/10'),          # IPv6 link-local
]

# Hostnames that are always blocked regardless of DNS resolution
BLOCKED_HOSTNAMES = {
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '169.254.169.254',
}


def _is_ip_blocked(ip_str: str) -> bool:
    """Check if an IP address falls within any blocked network."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in network for network in BLOCKED_NETWORKS)
    except ValueError:
        return False


def validate_url_safe(url: str) -> Tuple[bool, str]:
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
