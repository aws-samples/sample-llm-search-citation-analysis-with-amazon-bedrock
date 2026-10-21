"""
Following a spill pointer: a router answer over 5 MB arrives as a presigned S3 URL the server reads in its place.

The pointer contract is ``shared.response_spill`` (``spilled_location``); these
tests replay a tool call whose router answered the pointer and check the body
read from S3 is what the caller gets, and that every failure to read it is the
same generic 502 as a failed router.
"""

from __future__ import annotations

import io
import json
import logging

import invoke
import pytest
import requests
from catalogue import Route, find_operation
from invoke import MAX_RESULT_CHARS, SPILL_TIMEOUT_SECONDS, invoke_route, run_operation, spill_session

from testing.mcp_spill_fixtures import SPILL_URL, FakeSpillSession, spill_pointer

ROUTE = Route('citations-content', 'GET', '/api/citations', '/api/citations', None, {'limit': '1000'}, None)
HANDLER_FAILED = (502, {'error': 'The API handler failed'})
SPILLED_BODY = {
    'citations': [{'url': f'https://hotel-coruna.es/habitación-{index}', 'citation_count': 3} for index in range(3)],
    'next_token': 'eyJvZmZzZXQiOiAzfQ',
}


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeSpillSession:
    """The S3 behind the presigned URL; serves ``SPILLED_BODY`` unless a test says otherwise."""
    session = FakeSpillSession()
    session.serve(200, SPILLED_BODY)
    monkeypatch.setattr(invoke, 'spill_session', lambda: session)
    return session


class TestPointerFollowed:
    def test_returns_the_spilled_body_with_the_routers_status(self, api, caller, store):
        api.answer(200, spill_pointer())

        assert invoke_route(ROUTE, caller) == (200, SPILLED_BODY)

    def test_a_tool_result_carries_the_spilled_body_and_its_next_token(self, api, caller, store):
        api.answer(200, spill_pointer())

        result = run_operation('get_citations', find_operation('get_citations'), {'view': 'list'}, caller)

        assert result['structuredContent'] == SPILLED_BODY

    def test_reads_the_url_with_a_timeout_streamed_and_without_redirects_or_headers(self, api, caller, store):
        api.answer(200, spill_pointer())

        invoke_route(ROUTE, caller)

        assert store.requests == [(SPILL_URL, {'timeout': SPILL_TIMEOUT_SECONDS, 'stream': True, 'allow_redirects': False})]

    def test_a_large_spilled_body_is_cut_to_a_first_page_that_keeps_next_token(self, api, caller, store):
        rows = [{'url': f'https://hotel-coruna.es/página-{index}', 'title': 'Habitación con vistas ' * 20} for index in range(2000)]
        store.serve(200, {'citations': rows, 'next_token': 'eyJvZmZzZXQiOiAyMDAwfQ'})
        api.answer(200, spill_pointer())

        data = run_operation('get_citations', find_operation('get_citations'), {'view': 'list'}, caller)['structuredContent']

        assert (data['truncated'], data['next_token']) == (True, 'eyJvZmZzZXQiOiAyMDAwfQ')
        assert len(json.dumps(data)) <= MAX_RESULT_CHARS


class TestNonPointerUntouched:
    def test_an_ordinary_body_is_returned_without_reading_s3(self, api, caller, store):
        api.answer(200, SPILLED_BODY)

        assert (invoke_route(ROUTE, caller), store.requests) == ((200, SPILLED_BODY), [])

    def test_a_body_with_a_spilled_response_field_among_others_is_data_not_a_pointer(self, api, caller, store):
        body = {**spill_pointer(), 'count': 1}
        api.answer(200, body)

        assert (invoke_route(ROUTE, caller), store.requests) == ((200, body), [])

    def test_an_error_body_is_returned_without_reading_s3(self, api, caller, store):
        api.answer(400, {'error': 'Invalid next_token', 'field': 'next_token'})

        assert invoke_route(ROUTE, caller) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})


class TestDownloadRefused:
    @pytest.mark.parametrize('url', [
        'https://attacker.example.com/api-responses/abc.json',
        'https://bucket.s3.amazonaws.com.attacker.example/abc.json',
        'https://notamazonaws.com/abc.json',
    ], ids=['foreign', 'suffix_in_path_of_host', 'lookalike'])
    def test_a_host_outside_amazonaws_com_is_refused_without_a_request(self, api, caller, store, url):
        api.answer(200, spill_pointer(url))

        assert (invoke_route(ROUTE, caller), store.requests) == (HANDLER_FAILED, [])

    def test_a_declared_content_length_over_32_mb_is_refused_before_reading(self, api, caller, store):
        store.serve(200, SPILLED_BODY, headers={'Content-Length': str(32 * 1024 * 1024 + 1)})
        api.answer(200, spill_pointer())

        assert (invoke_route(ROUTE, caller), store.last_response.chunks_read) == (HANDLER_FAILED, 0)

    def test_a_body_streaming_past_the_cap_without_a_length_is_refused(self, api, caller, store, monkeypatch):
        monkeypatch.setattr(invoke, 'MAX_SPILL_BYTES', 2048)
        store.serve(200, b'x' * 4096, headers={})
        api.answer(200, spill_pointer())

        assert (invoke_route(ROUTE, caller), store.last_response.chunks_read) == (HANDLER_FAILED, 3)

    def test_an_expired_url_answering_403_is_the_generic_502(self, api, caller, store):
        store.serve(403, b'<Error><Code>AccessDenied</Code></Error>')
        api.answer(200, spill_pointer())

        assert invoke_route(ROUTE, caller) == HANDLER_FAILED

    def test_a_body_that_is_not_json_is_the_generic_502(self, api, caller, store):
        store.serve(200, b'{"citations": [')
        api.answer(200, spill_pointer())

        assert invoke_route(ROUTE, caller) == HANDLER_FAILED

    def test_a_connection_failure_is_logged_without_the_presigned_signature(self, api, caller, store, caplog):
        caplog.set_level(logging.ERROR, logger='invoke')
        store.failure = requests.ConnectionError(f'Max retries exceeded with url: {SPILL_URL}')
        api.answer(200, spill_pointer())

        assert invoke_route(ROUTE, caller) == HANDLER_FAILED
        assert ('ConnectionError' in caplog.text, 'secret-signature' in caplog.text) == (True, False)

    def test_a_failed_download_is_a_tool_error(self, api, caller, store):
        store.failure = requests.Timeout('read timed out')
        api.answer(200, spill_pointer())

        result = run_operation('get_citations', find_operation('get_citations'), {'view': 'list'}, caller)

        assert (result['isError'], result['structuredContent']) == (True, {'status': 502, 'error': 'The API handler failed'})


class TestSpillSession:
    def test_ignores_netrc_credentials_and_proxy_settings_from_the_environment(self):
        with spill_session() as session:
            assert session.trust_env is False


class TestOversizedRouterAnswer:
    def test_a_response_the_runtime_refused_as_too_large_is_the_generic_502(self, api, caller):
        error = {'errorType': 'Function.ResponseSizeTooLarge',
                 'errorMessage': 'Response payload size exceeded maximum allowed payload size (6291556 bytes).'}
        api.client.invoke.return_value = {
            'StatusCode': 200, 'FunctionError': 'Unhandled', 'Payload': io.BytesIO(json.dumps(error).encode('utf-8')),
        }

        assert invoke_route(ROUTE, caller) == HANDLER_FAILED
