"""
Tests for SSRF-safe fetching with per-hop redirect validation.

REGRESSION (AUDIT-2026-08-19 §2.6): callers validated a URL and then fetched it
with `allow_redirects=True`, handing the chain to `requests`. The validation
covered only the URL the caller supplied, never the URL actually read — so a
validated public host answering `301 Location: http://127.0.0.1:9001/...` had
its internal response body returned to the caller.

The point of these tests is that the *feature* survives: redirects are still
followed, so Gemini's citation wrappers still resolve to real domains. What
changed is that each destination is checked before the next request.
"""

from __future__ import annotations

import importlib
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# The shared package __init__ re-exports api_response as a function, which can
# shadow the submodule. Point sys.path at lambda/ so `import shared.safe_fetch`
# resolves to the in-repo module.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

safe_fetch = importlib.import_module('shared.safe_fetch')

fetch_following_validated_redirects = safe_fetch.fetch_following_validated_redirects
host_matches = safe_fetch.host_matches
MAX_REDIRECT_HOPS = safe_fetch.MAX_REDIRECT_HOPS

PUBLIC_IP = '93.184.216.34'
INTERNAL_REDIRECT = 'http://169.254.169.254/latest/meta-data/'


def response_stub(status_code: int, location: str | None = None) -> MagicMock:
    """Build a minimal requests.Response stand-in."""
    response = MagicMock()
    response.status_code = status_code
    response.headers = {'Location': location} if location else {}
    return response


def public_dns() -> Any:
    """Patch DNS so every hostname resolves to a public address."""
    return patch(
        'shared.url_validator.socket.getaddrinfo',
        return_value=[(2, 1, 6, '', (PUBLIC_IP, 0))],
    )


class TestRedirectsAreStillFollowed:
    """The feature. Breaking this would silently degrade citation domains."""

    def test_returns_the_final_response_after_a_redirect(self) -> None:
        hops = [
            response_stub(302, 'https://real-site.example/article'),
            response_stub(200),
        ]
        with public_dns(), patch('shared.safe_fetch.requests.request', side_effect=hops):
            response, final_url, error = fetch_following_validated_redirects(
                'https://wrapper.example/redirect?id=1'
            )

        assert error == ''
        assert response.status_code == 200
        assert final_url == 'https://real-site.example/article'

    def test_follows_a_multi_hop_chain(self) -> None:
        hops = [
            response_stub(301, 'https://second.example/b'),
            response_stub(302, 'https://third.example/c'),
            response_stub(200),
        ]
        with public_dns(), patch('shared.safe_fetch.requests.request', side_effect=hops):
            _, final_url, error = fetch_following_validated_redirects('https://first.example/a')

        assert error == ''
        assert final_url == 'https://third.example/c'

    def test_resolves_a_relative_location_header(self) -> None:
        """A bare path in `Location` is legal and must resolve like a browser."""
        hops = [
            response_stub(302, '/articles/real'),
            response_stub(200),
        ]
        with public_dns(), patch('shared.safe_fetch.requests.request', side_effect=hops):
            _, final_url, error = fetch_following_validated_redirects(
                'https://wrapper.example/redirect'
            )

        assert error == ''
        assert final_url == 'https://wrapper.example/articles/real'

    def test_returns_immediately_when_there_is_no_redirect(self) -> None:
        with public_dns(), patch(
            'shared.safe_fetch.requests.request', return_value=response_stub(200)
        ):
            _, final_url, error = fetch_following_validated_redirects('https://site.example/page')

        assert error == ''
        assert final_url == 'https://site.example/page'

    def test_preserves_the_requested_method_across_hops(self) -> None:
        """The Gemini un-wrapper uses HEAD; a switch to GET would fetch bodies."""
        hops = [
            response_stub(302, 'https://real-site.example/article'),
            response_stub(200),
        ]
        with public_dns(), patch(
            'shared.safe_fetch.requests.request', side_effect=hops
        ) as mock_request:
            fetch_following_validated_redirects(
                'https://wrapper.example/r', method='HEAD'
            )

        assert [call.args[0] for call in mock_request.call_args_list] == ['HEAD', 'HEAD']


class TestRedirectsToRestrictedAddressesAreBlocked:
    """The regression. Every one of these was previously followed."""

    def test_refuses_a_redirect_to_the_metadata_address(self) -> None:
        with public_dns(), patch(
            'shared.safe_fetch.requests.request',
            side_effect=[response_stub(302, INTERNAL_REDIRECT)],
        ):
            response, final_url, error = fetch_following_validated_redirects(
                'https://attacker.example/page'
            )

        assert response is None
        assert final_url is None
        assert error

    def test_refuses_a_redirect_to_loopback(self) -> None:
        """Where the Lambda Runtime API lives."""
        with public_dns(), patch(
            'shared.safe_fetch.requests.request',
            side_effect=[response_stub(302, 'http://127.0.0.1:9001/2018-06-01/runtime/invocation/next')],
        ):
            _, _, error = fetch_following_validated_redirects('https://attacker.example/page')

        assert error

    def test_does_not_request_the_restricted_destination(self) -> None:
        """
        A 403-style refusal that still issued the request would leak the
        response into timing and error behavior.
        """
        with public_dns(), patch(
            'shared.safe_fetch.requests.request',
            side_effect=[response_stub(302, INTERNAL_REDIRECT)],
        ) as mock_request:
            fetch_following_validated_redirects('https://attacker.example/page')

        requested = [call.args[1] for call in mock_request.call_args_list]
        assert requested == ['https://attacker.example/page']

    def test_refuses_a_redirect_to_a_non_http_scheme(self) -> None:
        with public_dns(), patch(
            'shared.safe_fetch.requests.request',
            side_effect=[response_stub(302, 'file:///etc/passwd')],
        ):
            _, _, error = fetch_following_validated_redirects('https://attacker.example/page')

        assert error

    def test_refuses_an_internal_url_before_the_first_request(self) -> None:
        with patch('shared.safe_fetch.requests.request') as mock_request:
            _, _, error = fetch_following_validated_redirects(INTERNAL_REDIRECT)

        assert error
        assert mock_request.call_count == 0

    def test_error_message_does_not_name_the_blocked_destination(self) -> None:
        """Echoing the hop back would confirm what is reachable internally."""
        with public_dns(), patch(
            'shared.safe_fetch.requests.request',
            side_effect=[response_stub(302, INTERNAL_REDIRECT)],
        ):
            _, _, error = fetch_following_validated_redirects('https://attacker.example/page')

        assert '169.254.169.254' not in error


class TestChainLimits:
    """An unbounded chain is a hang, and a hang in Lambda is a billed timeout."""

    def test_stops_after_the_hop_limit(self) -> None:
        endless = [response_stub(302, f'https://hop{index}.example/') for index in range(20)]
        with public_dns(), patch('shared.safe_fetch.requests.request', side_effect=endless):
            response, _, error = fetch_following_validated_redirects(
                'https://start.example/', max_hops=3
            )

        assert response is None
        assert 'redirect' in error.lower()

    def test_issues_no_more_requests_than_the_hop_limit_allows(self) -> None:
        endless = [response_stub(302, f'https://hop{index}.example/') for index in range(20)]
        with public_dns(), patch(
            'shared.safe_fetch.requests.request', side_effect=endless
        ) as mock_request:
            fetch_following_validated_redirects('https://start.example/', max_hops=3)

        assert mock_request.call_count == 4

    def test_defaults_to_a_small_hop_limit(self) -> None:
        assert MAX_REDIRECT_HOPS == 5

    def test_treats_a_redirect_without_a_location_as_final(self) -> None:
        with public_dns(), patch(
            'shared.safe_fetch.requests.request', side_effect=[response_stub(302)]
        ):
            response, _, error = fetch_following_validated_redirects('https://site.example/')

        assert error == ''
        assert response.status_code == 302


class TestTransportFailures:
    """A network error must not surface as an unhandled exception."""

    def test_returns_a_generic_error_when_the_request_raises(self) -> None:
        request_exception = safe_fetch.requests.RequestException('connection reset')
        with public_dns(), patch(
            'shared.safe_fetch.requests.request', side_effect=request_exception
        ):
            response, _, error = fetch_following_validated_redirects('https://site.example/')

        assert response is None
        assert error == 'Could not fetch the requested URL'


class TestHostMatches:
    """Guards the allowlist that restricts which hosts may start a chain."""

    ALLOWED = frozenset({'vertexaisearch.cloud.google.com'})

    def test_accepts_the_exact_host(self) -> None:
        assert host_matches('https://vertexaisearch.cloud.google.com/grounding?id=1', self.ALLOWED)

    def test_accepts_the_host_case_insensitively(self) -> None:
        assert host_matches('https://VertexAISearch.Cloud.Google.com/x', self.ALLOWED)

    def test_rejects_a_suffix_impersonation(self) -> None:
        """REGRESSION guard: a substring test would accept this."""
        assert not host_matches(
            'https://vertexaisearch.cloud.google.com.attacker.example/x', self.ALLOWED
        )

    def test_rejects_a_subdomain_of_the_allowed_host(self) -> None:
        assert not host_matches('https://evil.vertexaisearch.cloud.google.com/x', self.ALLOWED)

    def test_rejects_the_host_appearing_only_in_the_path(self) -> None:
        assert not host_matches(
            'https://attacker.example/vertexaisearch.cloud.google.com', self.ALLOWED
        )

    @pytest.mark.parametrize('url', ['', 'not a url', 'https://'])
    def test_rejects_unparseable_input(self, url) -> None:
        assert not host_matches(url, self.ALLOWED)
