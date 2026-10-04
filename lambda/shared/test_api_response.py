"""
Tests for CORS origin fallback behavior in api_response.py.

Covers:
- Property 1: CORS fallback fails closed for non-dev environments
- Unit tests for specific CORS fallback scenarios
"""

import importlib
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError
from hypothesis import given, settings
from hypothesis import strategies as st

from testing.cors_fixtures import configured_cors_origin, credentialed_json_headers
from testing.env import cleared_env

# The submodule itself is what `importlib.reload` needs.
cors_module = importlib.import_module('shared.api_response')


def _reload_and_get_origin():
    """Reload the module to clear the cached CORS origin, then call get_cors_origin()."""
    importlib.reload(cors_module)
    return cors_module.get_cors_origin()


def _origin_without_ssm_param(allow_dev_cors: str | None) -> str:
    """The fresh-container origin when CORS_ORIGIN_PARAM is unset; ``None`` leaves ALLOW_DEV_CORS unset too."""
    with cleared_env('CORS_ORIGIN_PARAM', 'ALLOW_DEV_CORS'):
        if allow_dev_cors is not None:
            os.environ['ALLOW_DEV_CORS'] = allow_dev_cors
        return _reload_and_get_origin()


def _ssm_client(side_effects):
    """Build a boto3 stand-in whose get_parameter follows `side_effects`."""
    client = MagicMock()
    client.get_parameter.side_effect = side_effects
    return client


def _reload_and_get_origin_from_ssm(client) -> str:
    """The fresh-container origin when CORS_ORIGIN_PARAM names an SSM parameter served by `client`."""
    with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/citation-analysis/cors-origin'}, clear=False), \
         patch('boto3.client', return_value=client):
        return _reload_and_get_origin()


def _get_parameter_error(code: str, message: str) -> ClientError:
    return ClientError({'Error': {'Code': code, 'Message': message}}, 'GetParameter')


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
        result = _origin_without_ssm_param(allow_dev_cors)
        assert result == '', f"Expected empty string for ALLOW_DEV_CORS={allow_dev_cors!r}, got {result!r}"

    @given(true_variant=st.sampled_from(['true', 'True', 'TRUE', 'tRuE', 'trUE']))
    @settings(max_examples=10)
    def test_true_variants_return_wildcard(self, true_variant):
        """Case-insensitive 'true' should return wildcard."""
        result = _origin_without_ssm_param(true_variant)
        assert result == '*', f"Expected '*' for ALLOW_DEV_CORS={true_variant!r}, got {result!r}"


# =============================================================================
# Unit Tests
# =============================================================================

class TestCORSFallbackUnit:
    """Unit tests for specific CORS fallback scenarios. Requirements: 2.1, 2.2, 2.3, 2.4"""

    @pytest.mark.parametrize(
        ('allow_dev_cors', 'expected'),
        [
            pytest.param(None, '', id='no_env_vars_fail_closed'),
            pytest.param('true', '*', id='allow_dev_cors_true_wildcard'),
            pytest.param('TRUE', '*', id='allow_dev_cors_TRUE_wildcard_case_insensitive'),
            pytest.param('false', '', id='allow_dev_cors_false_empty'),
        ],
    )
    def test_returns_dev_fallback_origin_when_ssm_param_is_unset(self, allow_dev_cors, expected):
        assert _origin_without_ssm_param(allow_dev_cors) == expected

    def test_cors_origin_param_set_reads_from_ssm(self):
        """CORS_ORIGIN_PARAM set → reads from SSM."""
        mock_ssm = _ssm_client([{'Parameter': {'Value': 'https://d123.cloudfront.net'}}])

        result = _reload_and_get_origin_from_ssm(mock_ssm)

        assert result == 'https://d123.cloudfront.net'
        mock_ssm.get_parameter.assert_called_once_with(Name='/citation-analysis/cors-origin')

    def test_ssm_failure_returns_empty(self):
        """SSM ClientError → returns empty string (fail secure)."""
        mock_ssm = _ssm_client(_get_parameter_error('ParameterNotFound', 'not found'))

        assert _reload_and_get_origin_from_ssm(mock_ssm) == ''


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
    def _throttling_error():
        return _get_parameter_error('ThrottlingException', 'Rate exceeded')

    @staticmethod
    def _origins(client, calls: int) -> list[str]:
        """What `calls` successive requests in one warm container get back as the CORS origin."""
        with patch.dict(os.environ, {'CORS_ORIGIN_PARAM': '/cors/origin'}, clear=False), \
             patch.object(cors_module.boto3, 'client', return_value=client):
            return [cors_module.get_cors_origin() for _ in range(calls)]

    def test_returns_empty_origin_for_the_failing_request(self):
        """Fail closed: the request that hit the error gets no origin."""
        importlib.reload(cors_module)
        client = _ssm_client([self._throttling_error()])

        assert self._origins(client, calls=1) == ['']

    def test_retries_ssm_on_the_next_request_after_a_failure(self):
        """
        The whole point: a later request in the same container must re-read
        SSM and recover, rather than serving the cached failure forever.
        """
        importlib.reload(cors_module)
        configured = 'https://dashboard.example.com'
        client = _ssm_client([
            self._throttling_error(),
            {'Parameter': {'Value': configured}},
        ])

        assert self._origins(client, calls=2) == ['', configured]

    def test_makes_a_second_ssm_call_after_a_failure(self):
        """A cached failure would short-circuit before reaching SSM again."""
        importlib.reload(cors_module)
        client = _ssm_client([
            self._throttling_error(),
            {'Parameter': {'Value': 'https://dashboard.example.com'}},
        ])

        self._origins(client, calls=2)

        assert client.get_parameter.call_count == 2

    def test_caches_a_successful_lookup(self):
        """Success must still be cached — this is a per-invocation hot path."""
        importlib.reload(cors_module)
        configured = 'https://dashboard.example.com'
        client = _ssm_client([{'Parameter': {'Value': configured}}])

        assert self._origins(client, calls=2) == [configured, configured]
        assert client.get_parameter.call_count == 1

    def test_still_caches_the_static_misconfiguration_path(self):
        """
        An unset CORS_ORIGIN_PARAM is a deploy-time state, not a transient
        error, so caching '' there is correct and must not have regressed.
        """
        first = _origin_without_ssm_param(None)

        assert first == ''
        assert cors_module._cors_origin_cache == ''


class TestCorsJsonHeaders:
    """`cors_json_headers` reads the request Origin from the event in any header casing."""

    @pytest.mark.parametrize('header_name', ['origin', 'Origin', 'ORIGIN'])
    def test_echoes_an_allowed_localhost_origin_given_in_any_header_casing(self, header_name):
        event = {'headers': {header_name: 'http://localhost:5173'}}

        with configured_cors_origin(allow_localhost=True):
            headers = cors_module.cors_json_headers(event)

        assert headers == credentialed_json_headers('http://localhost:5173')
