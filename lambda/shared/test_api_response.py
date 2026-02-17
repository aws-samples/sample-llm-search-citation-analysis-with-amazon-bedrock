"""
Tests for CORS origin fallback behavior in api_response.py.

Covers:
- Property 1: CORS fallback fails closed for non-dev environments
- Unit tests for specific CORS fallback scenarios
"""

import importlib
import os
import sys
from unittest.mock import patch, MagicMock

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# Add lambda/shared to path so we can import api_response directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

import api_response as cors_module


def _reload_and_get_origin():
    """Reload the module to clear the cached CORS origin, then call get_cors_origin()."""
    importlib.reload(cors_module)
    return cors_module.get_cors_origin()


# =============================================================================
# Property-Based Test
# =============================================================================

class TestCORSFallbackProperty:
    """
    **Property 1: CORS fallback fails closed for non-dev environments**
    
    For any value of ALLOW_DEV_CORS that is not case-insensitive "true",
    when CORS_ORIGIN_PARAM is also not set, get_cors_origin() returns empty string.
    
    **Validates: Requirements 2.4**
    """

    @given(allow_dev_cors=st.text().filter(lambda s: s.lower() != 'true' and '\x00' not in s))
    @settings(max_examples=100)
    def test_non_true_values_fail_closed(self, allow_dev_cors):
        """Any ALLOW_DEV_CORS value that isn't case-insensitive 'true' should fail closed."""
        env = {'ALLOW_DEV_CORS': allow_dev_cors}
        # Ensure CORS_ORIGIN_PARAM is NOT set
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            result = _reload_and_get_origin()
            assert result == '', f"Expected empty string for ALLOW_DEV_CORS={allow_dev_cors!r}, got {result!r}"

    @given(true_variant=st.sampled_from(['true', 'True', 'TRUE', 'tRuE', 'trUE']))
    @settings(max_examples=10)
    def test_true_variants_return_wildcard(self, true_variant):
        """Case-insensitive 'true' should return wildcard."""
        env = {'ALLOW_DEV_CORS': true_variant}
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            result = _reload_and_get_origin()
            assert result == '*', f"Expected '*' for ALLOW_DEV_CORS={true_variant!r}, got {result!r}"


# =============================================================================
# Unit Tests
# =============================================================================

class TestCORSFallbackUnit:
    """Unit tests for specific CORS fallback scenarios. Requirements: 2.1, 2.2, 2.3, 2.4"""

    def test_no_env_vars_returns_empty(self):
        """No env vars set → returns empty string (fail closed)."""
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            os.environ.pop('ALLOW_DEV_CORS', None)
            result = _reload_and_get_origin()
            assert result == ''

    def test_allow_dev_cors_true_returns_wildcard(self):
        """ALLOW_DEV_CORS=true → returns '*'."""
        with patch.dict(os.environ, {'ALLOW_DEV_CORS': 'true'}, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            result = _reload_and_get_origin()
            assert result == '*'

    def test_allow_dev_cors_TRUE_returns_wildcard(self):
        """ALLOW_DEV_CORS=TRUE → returns '*' (case insensitive)."""
        with patch.dict(os.environ, {'ALLOW_DEV_CORS': 'TRUE'}, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            result = _reload_and_get_origin()
            assert result == '*'

    def test_allow_dev_cors_false_returns_empty(self):
        """ALLOW_DEV_CORS=false → returns empty string."""
        with patch.dict(os.environ, {'ALLOW_DEV_CORS': 'false'}, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            result = _reload_and_get_origin()
            assert result == ''

    def test_cors_origin_param_set_reads_from_ssm(self):
        """CORS_ORIGIN_PARAM set → reads from SSM."""
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.return_value = {
            'Parameter': {'Value': 'https://d123.cloudfront.net'}
        }

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/citation-analysis/cors-origin'}, clear=False):
            with patch('boto3.client', return_value=mock_ssm):
                result = _reload_and_get_origin()
                assert result == 'https://d123.cloudfront.net'
                mock_ssm.get_parameter.assert_called_once_with(Name='/citation-analysis/cors-origin')

    def test_ssm_failure_returns_empty(self):
        """SSM ClientError → returns empty string (fail secure)."""
        from botocore.exceptions import ClientError
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.side_effect = ClientError(
            {'Error': {'Code': 'ParameterNotFound', 'Message': 'not found'}},
            'GetParameter'
        )

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/citation-analysis/cors-origin'}, clear=False):
            with patch('boto3.client', return_value=mock_ssm):
                result = _reload_and_get_origin()
                assert result == ''
