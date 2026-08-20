"""
Tests for CORS origin fallback behavior in api_response.py.

Covers:
- Property 1: CORS fallback fails closed for non-dev environments
- Unit tests for specific CORS fallback scenarios
"""

import importlib
import os
import sys
from unittest.mock import MagicMock, patch

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


class TestSsmFailureIsNotCached:
    """
    REGRESSION (AUDIT-2026-08-19 §2.13): the SSM failure path used to assign
    `_cors_origin_cache = ''` before returning. The sentinel check is
    `if _cors_origin_cache is not None`, so a cached '' is indistinguishable
    from a successful lookup, and one ThrottlingException blanked
    Access-Control-Allow-Origin for the rest of that warm container's life —
    minutes to hours of "works for me / broken for you" browser CORS errors
    from a single ERROR line at cold start.

    Failing closed for the failing request is correct. Caching the failure is
    what made it durable.
    """

    @staticmethod
    def _ssm_client(side_effects):
        """Build a boto3 stand-in whose get_parameter follows `side_effects`."""
        client = MagicMock()
        client.get_parameter.side_effect = side_effects
        return client

    @staticmethod
    def _throttling_error():
        from botocore.exceptions import ClientError
        return ClientError(
            {'Error': {'Code': 'ThrottlingException', 'Message': 'Rate exceeded'}},
            'GetParameter',
        )

    def test_returns_empty_origin_for_the_failing_request(self):
        """Fail closed: the request that hit the error gets no origin."""
        importlib.reload(cors_module)
        client = self._ssm_client([self._throttling_error()])

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/cors/origin'}, clear=False), \
             patch.object(cors_module.boto3, 'client', return_value=client):
            assert cors_module.get_cors_origin() == ''

    def test_retries_ssm_on_the_next_request_after_a_failure(self):
        """
        The whole point: a later request in the same container must re-read
        SSM and recover, rather than serving the cached failure forever.
        """
        importlib.reload(cors_module)
        configured = 'https://dashboard.example.com'
        client = self._ssm_client([
            self._throttling_error(),
            {'Parameter': {'Value': configured}},
        ])

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/cors/origin'}, clear=False), \
             patch.object(cors_module.boto3, 'client', return_value=client):
            first = cors_module.get_cors_origin()
            second = cors_module.get_cors_origin()

        assert first == ''
        assert second == configured

    def test_makes_a_second_ssm_call_after_a_failure(self):
        """A cached failure would short-circuit before reaching SSM again."""
        importlib.reload(cors_module)
        client = self._ssm_client([
            self._throttling_error(),
            {'Parameter': {'Value': 'https://dashboard.example.com'}},
        ])

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/cors/origin'}, clear=False), \
             patch.object(cors_module.boto3, 'client', return_value=client):
            cors_module.get_cors_origin()
            cors_module.get_cors_origin()

        assert client.get_parameter.call_count == 2

    def test_caches_a_successful_lookup(self):
        """Success must still be cached — this is a per-invocation hot path."""
        importlib.reload(cors_module)
        configured = 'https://dashboard.example.com'
        client = self._ssm_client([{'Parameter': {'Value': configured}}])

        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/cors/origin'}, clear=False), \
             patch.object(cors_module.boto3, 'client', return_value=client):
            first = cors_module.get_cors_origin()
            second = cors_module.get_cors_origin()

        assert (first, second) == (configured, configured)
        assert client.get_parameter.call_count == 1

    def test_still_caches_the_static_misconfiguration_path(self):
        """
        An unset CORS_ORIGIN_PARAM is a deploy-time state, not a transient
        error, so caching '' there is correct and must not have regressed.
        """
        importlib.reload(cors_module)

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('CORS_ORIGIN_PARAM', None)
            os.environ.pop('ALLOW_DEV_CORS', None)
            first = cors_module.get_cors_origin()

            assert first == ''
            assert cors_module._cors_origin_cache == ''
