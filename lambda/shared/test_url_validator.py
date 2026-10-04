"""
Tests for SSRF URL validator.

Covers:
- Property 2: URL scheme validation
- Property 3: Private IP rejection with safe error messages
- Unit tests for edge cases
"""

import socket
from unittest.mock import patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.url_validator import validate_url_safe

_RESOLVING_HOST = 'https://some-host.example.com'
_PUBLIC_IP = '93.184.216.34'
_OCTET = st.integers(min_value=0, max_value=255)
_HOST_OCTET = st.integers(min_value=1, max_value=254)


def _validate_resolving_to(ip, url=_RESOLVING_HOST):
    """Validate ``url`` with DNS stubbed to resolve its hostname to ``ip``."""
    addr_info = [(2, 1, 6, '', (ip, 0))]
    with patch('shared.url_validator.socket.getaddrinfo', return_value=addr_info):
        return validate_url_safe(url)


def _assert_rejected_without_leaking(ip):
    """Assert a hostname resolving to ``ip`` is rejected without echoing ``ip``; return the error."""
    is_safe, error = _validate_resolving_to(ip)
    assert not is_safe, f'Expected rejection for IP {ip}'
    assert ip not in error, f'Error message should not leak resolved IP {ip}'
    return error


# =============================================================================
# Property-Based Tests
# =============================================================================

class TestURLSchemeProperty:
    """
    **Property 2: URL scheme validation**

    For any URL, validate_url_safe() returns (True, "") only if the URL has
    an http or https scheme. All other schemes are rejected.

    **Validates: Requirements 3.1, 3.2**
    """

    @given(scheme=st.sampled_from(['ftp', 'file', 'gopher', 'javascript', 'data', 'ssh', 'telnet', 'ldap']))
    @settings(max_examples=50)
    def test_non_http_schemes_rejected(self, scheme):
        """Any non-http/https scheme should be rejected."""
        url = f'{scheme}://example.com/path'
        is_safe, error = validate_url_safe(url)
        assert not is_safe, f'Expected rejection for scheme {scheme}'
        assert error, 'Error message should not be empty'

    @given(scheme=st.sampled_from(['http', 'https']))
    @settings(max_examples=20)
    def test_http_schemes_not_rejected_for_scheme(self, scheme):
        """http/https schemes should not be rejected for scheme reasons."""
        # DNS resolves to a safe public IP so only the scheme logic is tested
        is_safe, error = _validate_resolving_to(_PUBLIC_IP, f'{scheme}://example.com')
        assert is_safe, f'Expected acceptance for scheme {scheme}, got error: {error}'


class TestPrivateIPProperty:
    """
    **Property 3: Private IP rejection with safe error messages**

    For any URL whose hostname resolves to a private/reserved IP,
    validate_url_safe() rejects it and the error message does not
    contain the resolved IP address.

    **Validates: Requirements 3.3, 3.4**
    """

    @given(octet2=_OCTET, octet3=_OCTET, octet4=_HOST_OCTET)
    @settings(max_examples=100)
    def test_10_x_range_rejected(self, octet2, octet3, octet4):
        """10.x.x.x addresses should always be rejected."""
        error = _assert_rejected_without_leaking(f'10.{octet2}.{octet3}.{octet4}')
        assert error, 'Error message should not be empty'

    @given(octet3=_OCTET, octet4=_HOST_OCTET)
    @settings(max_examples=50)
    def test_192_168_range_rejected(self, octet3, octet4):
        """192.168.x.x addresses should always be rejected."""
        _assert_rejected_without_leaking(f'192.168.{octet3}.{octet4}')

    @given(octet2=st.integers(min_value=16, max_value=31), octet3=_OCTET, octet4=_HOST_OCTET)
    @settings(max_examples=50)
    def test_172_16_range_rejected(self, octet2, octet3, octet4):
        """172.16-31.x.x addresses should always be rejected."""
        _assert_rejected_without_leaking(f'172.{octet2}.{octet3}.{octet4}')


# =============================================================================
# Unit Tests
# =============================================================================

class TestURLValidatorUnit:
    """Unit tests for URL validator edge cases. Requirements: 3.1-3.5"""

    def test_localhost_blocked(self):
        is_safe, error = validate_url_safe('http://localhost:8080/path')
        assert not is_safe
        assert 'restricted' in error.lower()

    @pytest.mark.parametrize(
        'url',
        [
            pytest.param('http://127.0.0.1/latest/meta-data/', id='ipv4_loopback'),
            pytest.param('http://[::1]:8080/', id='ipv6_loopback'),
            pytest.param('http://169.254.169.254/latest/meta-data/', id='metadata_endpoint'),
            pytest.param('http://0.0.0.0/', id='zero_address'),
            pytest.param('', id='empty_string'),
            pytest.param('javascript:alert(1)', id='javascript_scheme'),
        ],
    )
    def test_rejects_url_without_dns_lookup(self, url):
        is_safe, _ = validate_url_safe(url)
        assert not is_safe

    def test_accepts_public_url_with_empty_error(self):
        is_safe, error = _validate_resolving_to(_PUBLIC_IP, 'https://example.com/page')
        assert is_safe is True
        assert error == ''

    @pytest.mark.parametrize(
        'url',
        [
            pytest.param('example.com', id='missing_scheme'),
            pytest.param('ftp://files.example.com/data.csv', id='ftp_scheme'),
        ],
    )
    def test_rejects_url_with_scheme_error(self, url):
        is_safe, error = validate_url_safe(url)
        assert not is_safe
        assert 'scheme' in error.lower()

    def test_dns_failure_rejected(self):
        with patch('shared.url_validator.socket.getaddrinfo', side_effect=socket.gaierror('Name resolution failed')):
            is_safe, error = validate_url_safe('https://nonexistent.invalid')
        assert not is_safe
        assert 'resolve' in error.lower()

    def test_link_local_169_254_range_blocked(self):
        is_safe, _ = _validate_resolving_to('169.254.1.1', 'https://sneaky.example.com')
        assert not is_safe



class TestRangesThatPreviouslyBypassedValidation:
    """
    REGRESSION (AUDIT-2026-08-19 §2.5). Each address below resolved to a
    restricted range that the original blocklist let through.

    The headline case is the IPv4-mapped one: `IPv6Address in IPv4Network`
    returns False *silently*, so a hostname with an AAAA record of
    `::ffff:169.254.169.254` skipped all nine IPv4 rules without any error.
    """

    @pytest.mark.parametrize(
        ('ip', 'why'),
        [
            ('::ffff:169.254.169.254', 'IPv4-mapped link-local skipped every IPv4 rule'),
            ('::ffff:127.0.0.1', 'IPv4-mapped loopback'),
            ('::ffff:10.0.0.1', 'IPv4-mapped RFC1918'),
            ('2002:a9fe:a9fe::1', '6to4 wrapping link-local'),
            ('64:ff9b::a9fe:a9fe', 'NAT64 — alternate route to IPv4 link-local'),
            ('fc00::1', 'fc00 half of ULA, missed by the fd00::/8 entry'),
            ('100.64.0.1', 'CGNAT — the one range the stdlib does not flag'),
            ('192.0.0.1', 'IETF protocol assignments'),
            ('198.18.0.1', 'benchmarking range'),
            ('224.0.0.1', 'multicast'),
            ('240.0.0.1', 'reserved'),
        ],
    )
    def test_rejects_address_and_does_not_leak_it(self, ip, why):
        is_safe, error = _validate_resolving_to(ip)

        assert not is_safe, f'Expected rejection: {why}'
        assert ip not in error, 'Error message must not leak the resolved IP'


class TestFailsClosedOnUnparseableAddresses:
    """
    `_is_ip_blocked` used to `return False` from `except ValueError`, so
    anything the parser rejected was treated as safe.
    """

    @pytest.mark.parametrize(
        'ip',
        ['not-an-ip', '', '999.999.999.999', 'fe80::1%eth0'],
    )
    def test_rejects_when_resolution_yields_an_unparseable_address(self, ip):
        is_safe, _ = _validate_resolving_to(ip)

        assert not is_safe


class TestIpLiteralHostnames:
    """
    An IP literal needs no DNS, so it is judged directly. The literal
    blocklist cannot enumerate every encoding of a restricted address.
    """

    @pytest.mark.parametrize(
        'url',
        [
            pytest.param('http://[::ffff:169.254.169.254]/latest/meta-data/', id='bracketed_ipv4_mapped'),
            pytest.param('http://[fc00::1]/', id='ipv6_unique_local'),
            pytest.param('http://100.64.0.1/', id='cgnat'),
        ],
    )
    def test_rejects_restricted_ip_literal(self, url):
        is_safe, _ = validate_url_safe(url)

        assert not is_safe


class TestLegitimateAddressesStillAllowed:
    """
    A validator that rejects everything is not a fix. These prove the widened
    blocklist did not start refusing real public hosts.
    """

    @pytest.mark.parametrize(
        'ip',
        [_PUBLIC_IP, '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946'],
    )
    def test_accepts_public_address(self, ip):
        is_safe, error = _validate_resolving_to(ip, 'https://example.com/page')

        assert is_safe, f'Expected {ip} to be allowed, got: {error}'
