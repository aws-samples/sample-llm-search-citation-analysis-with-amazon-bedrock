"""
Tests for SSRF URL validator.

Covers:
- Property 2: URL scheme validation
- Property 3: Private IP rejection with safe error messages
- Unit tests for edge cases
"""

import os
import sys
from unittest.mock import patch

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from url_validator import validate_url_safe, _is_ip_blocked


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
        url = f'{scheme}://example.com'
        # Mock DNS to return a safe public IP so we only test scheme logic
        safe_addr_info = [(2, 1, 6, '', ('93.184.216.34', 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=safe_addr_info):
            is_safe, error = validate_url_safe(url)
            assert is_safe, f'Expected acceptance for scheme {scheme}, got error: {error}'


class TestPrivateIPProperty:
    """
    **Property 3: Private IP rejection with safe error messages**

    For any URL whose hostname resolves to a private/reserved IP,
    validate_url_safe() rejects it and the error message does not
    contain the resolved IP address.

    **Validates: Requirements 3.3, 3.4**
    """

    @given(
        octet2=st.integers(min_value=0, max_value=255),
        octet3=st.integers(min_value=0, max_value=255),
        octet4=st.integers(min_value=1, max_value=254),
    )
    @settings(max_examples=100)
    def test_10_x_range_rejected(self, octet2, octet3, octet4):
        """10.x.x.x addresses should always be rejected."""
        ip = f'10.{octet2}.{octet3}.{octet4}'
        addr_info = [(2, 1, 6, '', (ip, 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=addr_info):
            is_safe, error = validate_url_safe('https://some-host.example.com')
            assert not is_safe, f'Expected rejection for IP {ip}'
            assert ip not in error, f'Error message should not contain resolved IP {ip}'
            assert error, 'Error message should not be empty'

    @given(
        octet3=st.integers(min_value=0, max_value=255),
        octet4=st.integers(min_value=1, max_value=254),
    )
    @settings(max_examples=50)
    def test_192_168_range_rejected(self, octet3, octet4):
        """192.168.x.x addresses should always be rejected."""
        ip = f'192.168.{octet3}.{octet4}'
        addr_info = [(2, 1, 6, '', (ip, 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=addr_info):
            is_safe, error = validate_url_safe('https://some-host.example.com')
            assert not is_safe, f'Expected rejection for IP {ip}'
            assert ip not in error, f'Error message should not leak IP {ip}'

    @given(
        octet2=st.integers(min_value=16, max_value=31),
        octet3=st.integers(min_value=0, max_value=255),
        octet4=st.integers(min_value=1, max_value=254),
    )
    @settings(max_examples=50)
    def test_172_16_range_rejected(self, octet2, octet3, octet4):
        """172.16-31.x.x addresses should always be rejected."""
        ip = f'172.{octet2}.{octet3}.{octet4}'
        addr_info = [(2, 1, 6, '', (ip, 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=addr_info):
            is_safe, error = validate_url_safe('https://some-host.example.com')
            assert not is_safe, f'Expected rejection for IP {ip}'
            assert ip not in error, f'Error message should not leak IP {ip}'


# =============================================================================
# Unit Tests
# =============================================================================

class TestURLValidatorUnit:
    """Unit tests for URL validator edge cases. Requirements: 3.1-3.5"""

    def test_localhost_blocked(self):
        is_safe, error = validate_url_safe('http://localhost:8080/path')
        assert not is_safe
        assert 'restricted' in error.lower()

    def test_127_0_0_1_blocked(self):
        is_safe, error = validate_url_safe('http://127.0.0.1/latest/meta-data/')
        assert not is_safe

    def test_ipv6_loopback_blocked(self):
        is_safe, error = validate_url_safe('http://[::1]:8080/')
        assert not is_safe

    def test_metadata_endpoint_blocked(self):
        is_safe, error = validate_url_safe('http://169.254.169.254/latest/meta-data/')
        assert not is_safe

    def test_zero_address_blocked(self):
        is_safe, error = validate_url_safe('http://0.0.0.0/')
        assert not is_safe

    def test_valid_public_url(self):
        safe_addr_info = [(2, 1, 6, '', ('93.184.216.34', 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=safe_addr_info):
            is_safe, error = validate_url_safe('https://example.com/page')
            assert is_safe
            assert error == ''

    def test_empty_string_rejected(self):
        is_safe, error = validate_url_safe('')
        assert not is_safe

    def test_missing_scheme_rejected(self):
        is_safe, error = validate_url_safe('example.com')
        assert not is_safe
        assert 'scheme' in error.lower()

    def test_dns_failure_rejected(self):
        import socket as sock_mod
        with patch('url_validator.socket.getaddrinfo', side_effect=sock_mod.gaierror('Name resolution failed')):
            is_safe, error = validate_url_safe('https://nonexistent.invalid')
            assert not is_safe
            assert 'resolve' in error.lower()

    def test_ftp_scheme_rejected(self):
        is_safe, error = validate_url_safe('ftp://files.example.com/data.csv')
        assert not is_safe
        assert 'scheme' in error.lower()

    def test_javascript_scheme_rejected(self):
        is_safe, error = validate_url_safe('javascript:alert(1)')
        assert not is_safe

    def test_link_local_169_254_range_blocked(self):
        addr_info = [(2, 1, 6, '', ('169.254.1.1', 0))]
        with patch('url_validator.socket.getaddrinfo', return_value=addr_info):
            is_safe, error = validate_url_safe('https://sneaky.example.com')
            assert not is_safe
