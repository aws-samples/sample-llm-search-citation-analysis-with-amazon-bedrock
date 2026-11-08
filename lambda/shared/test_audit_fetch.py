"""SSRF-guarded fetches of the site audit (``shared.audit_fetch``)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import requests

from shared import audit_fetch
from shared.audit_fetch import BlockedAddressError, RawResponse, fetch_following, fetch_once
from testing.site_audit_fixtures import FakeSite, redirect, serving, text_response


def test_fetch_refuses_before_connecting_when_the_name_resolves_to_a_private_address():
    send = MagicMock()
    with patch.object(audit_fetch, '_send', send), \
            patch.object(audit_fetch, 'validate_url_safe', return_value=(False, 'restricted')):
        result = fetch_once('https://www.example.com/', max_bytes=100)

    assert (result.status, result.error, send.call_count) == (0, 'blocked_address', 0)


@pytest.mark.parametrize(('failure', 'expected'), [
    (BlockedAddressError('x'), 'blocked_address'),
    (requests.ConnectTimeout(), 'ConnectTimeout'),
])
def test_fetch_reports_a_status_0_error_when_the_transport_fails(failure, expected):
    with patch.object(audit_fetch, '_send', side_effect=failure), \
            patch.object(audit_fetch, 'validate_url_safe', return_value=(True, '')):
        result = fetch_once('https://www.example.com/', max_bytes=100)

    assert (result.status, result.error) == (0, expected)


def test_fetch_never_sends_to_an_internal_literal_even_when_dns_is_not_consulted():
    send = MagicMock()
    with patch.object(audit_fetch, '_send', send):
        result = fetch_once('http://169.254.169.254/latest', max_bytes=100)

    assert (result.error, send.call_count) == ('not_crawlable', 0)


def test_fetch_once_does_not_follow_a_redirect():
    site = FakeSite({'https://www.example.com/a': redirect('/b')})
    with serving(site):
        result = fetch_once('https://www.example.com/a', max_bytes=100)

    assert (result.status, result.location, site.requests) == (301, 'https://www.example.com/b', ['https://www.example.com/a'])


def test_fetch_following_refuses_a_hop_to_an_internal_address():
    site = FakeSite({'https://www.example.com/robots.txt': redirect('http://127.0.0.1/robots.txt')})
    with serving(site):
        result = fetch_following('https://www.example.com/robots.txt', max_bytes=100, accept='*/*', timeout_s=5)

    assert (result.status, result.error, len(site.requests)) == (0, 'redirect_refused', 1)


def test_fetch_following_gives_up_after_five_redirects():
    site = FakeSite({f'https://www.example.com/{index}': redirect(f'/{index + 1}') for index in range(10)})
    with serving(site):
        result = fetch_following('https://www.example.com/0', max_bytes=100, accept='*/*', timeout_s=5)

    assert (result.error, len(site.requests)) == ('too_many_redirects', 6)


def test_fetch_following_answers_the_final_url_after_redirects():
    site = FakeSite({
        'https://example.com/robots.txt': redirect('https://www.example.com/robots.txt'),
        'https://www.example.com/robots.txt': text_response('User-agent: *'),
    })
    with serving(site):
        result = fetch_following('https://example.com/robots.txt', max_bytes=100, accept='*/*', timeout_s=5)

    assert (result.status, result.url) == (200, 'https://www.example.com/robots.txt')


def test_a_body_over_the_cap_is_truncated_to_the_cap():
    site = FakeSite({'https://www.example.com/big': RawResponse(200, {'content-type': 'text/html'}, b'x' * 50)})
    with serving(site):
        result = fetch_once('https://www.example.com/big', max_bytes=10)

    assert (len(result.body), result.truncated) == (10, True)


class _Socket:
    def __init__(self, peer: str) -> None:
        self.peer = peer

    def getpeername(self) -> tuple[str, int]:
        return self.peer, 443


def _response(peer: str) -> MagicMock:
    response = MagicMock()
    response.raw.connection.sock = _Socket(peer)
    response.status_code = 200
    response.headers = {'Content-Type': 'text/html'}
    response.iter_content.return_value = [b'<html>', b'</html>']
    return response


def test_transport_refuses_a_body_when_the_peer_address_is_private():
    with patch.object(audit_fetch.requests, 'get', return_value=_response('10.1.2.3')), \
            pytest.raises(BlockedAddressError):
        audit_fetch._send('https://www.example.com/', {}, 5, 100)


def test_transport_reads_the_body_when_the_peer_address_is_public():
    with patch.object(audit_fetch.requests, 'get', return_value=_response('93.184.216.34')):
        raw = audit_fetch._send('https://www.example.com/', {}, 5, 100)

    assert (raw.status, raw.body, raw.headers) == (200, b'<html></html>', {'content-type': 'text/html'})


def test_transport_never_follows_redirects_itself():
    get = MagicMock(return_value=_response('93.184.216.34'))
    with patch.object(audit_fetch.requests, 'get', get):
        audit_fetch._send('https://www.example.com/', {}, 5, 100)

    assert get.call_args.kwargs['allow_redirects'] is False
