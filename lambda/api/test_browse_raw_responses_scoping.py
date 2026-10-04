"""
Tests that raw-response object access stays inside the configured root prefix.

REGRESSION (AUDIT-2026-08-19 §2.7): `_get_file` and `_get_download` resolved the
bucket with `get_bucket_and_prefix` and then threw the prefix away, so a plain
relative key addressed any object in either bucket. The download route is the
sharp end: it mints a presigned URL signed with the Lambda role's credentials,
valid 15 minutes and redeemable by anyone — no Cognito account needed.

The scoping has to be idempotent, because the explorer sends *absolute* keys to
these two routes (the listing returns full S3 keys) but *relative* prefixes to
/browse. Getting that wrong would rewrite every legitimate key to
`raw-responses/raw-responses/...` and blank the file viewer and screenshot tab,
so the "already-prefixed key is unchanged" tests below are as load-bearing as
the containment ones.
"""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_MODULE_NAME = 'browse_raw_responses_under_test'

RESPONSES_BUCKET = 'test-raw-responses'
SCREENSHOTS_BUCKET = 'test-screenshots'

# A key already confined to the raw-responses root prefix.
_SCOPED_KEY = 'raw-responses/2026/08/openai.json'

_TEST_ENV = {
    'RAW_RESPONSES_BUCKET': RESPONSES_BUCKET,
    'SCREENSHOTS_BUCKET': SCREENSHOTS_BUCKET,
    'CORS_ORIGIN_PARAM': '',
}


def _load_handler() -> tuple[Any, MagicMock]:
    """Import the hyphenated handler module with S3 mocked at import time.

    The module binds ``s3_client`` while ``boto3.client`` is patched, so the
    stub returned here is the client every route uses.
    """
    s3 = MagicMock()
    s3.exceptions.NoSuchKey = type('NoSuchKey', (Exception,), {})
    s3.generate_presigned_url.return_value = 'https://signed.example/object'

    body = MagicMock()
    body.read.return_value = b'{"provider": "openai"}'
    s3.get_object.return_value = {
        'Body': body,
        'ContentLength': 22,
        'LastModified': _FakeTimestamp(),
        'ContentType': 'application/json',
    }

    with patch('boto3.client', return_value=s3), patch.dict(os.environ, _TEST_ENV):
        module = load_handler_module(_API_DIR, 'browse-raw-responses.py', _MODULE_NAME)

    return module, s3


class _FakeTimestamp:
    """Stands in for a boto3 datetime, which the handler calls .isoformat() on."""

    def isoformat(self) -> str:
        return '2026-08-19T10:00:00+00:00'


@pytest.fixture
def browse():
    """Provide the raw-responses module with a mocked S3 client."""
    module, s3 = _load_handler()
    yield module, s3
    sys.modules.pop(_MODULE_NAME, None)


def _get(module: Any, route: str, query: dict[str, str]) -> tuple[int, Any]:
    """``(status, decoded body)`` of ``GET /api/raw-responses<route>`` with the query string ``query``."""
    return parse_response(module.handler(api_gateway_event('GET', f'/api/raw-responses{route}', query=query), None))


def _request(module: Any, route: str, key: str, bucket: str = 'responses') -> tuple[int, Any]:
    """``(status, decoded body)`` of ``GET <route>`` for ``key`` in ``bucket``."""
    return _get(module, route, {'key': key, 'bucket': bucket})


def signed_key(s3: MagicMock) -> str:
    """Return the key from the most recent presigned-URL call."""
    return s3.generate_presigned_url.call_args.kwargs['Params']['Key']


def addressed_object(s3: MagicMock, route: str) -> dict[str, str]:
    """``{'Bucket', 'Key'}`` the most recent /file read or /download signature addressed."""
    if route == '/file':
        return s3.get_object.call_args.kwargs
    return s3.generate_presigned_url.call_args.kwargs['Params']


def listed_prefix(module: Any, s3: MagicMock, prefix: str) -> str:
    """The S3 ``Prefix`` the browse route lists for the ``prefix`` query parameter."""
    s3.list_objects_v2.return_value = {}
    event = api_gateway_event('GET', '/api/raw-responses/browse', query={'prefix': prefix}, headers={})

    module.handler(event, None)

    return s3.list_objects_v2.call_args.kwargs['Prefix']


class TestScopeKeyToRoot:
    """The helper in isolation, including its idempotence contract."""

    def test_prepends_the_root_prefix_to_a_relative_key(self, browse) -> None:
        module, _ = browse

        scoped, error = module.scope_key_to_root('2026/08/openai.json', 'raw-responses/')

        assert scoped == 'raw-responses/2026/08/openai.json'
        assert error is None

    def test_leaves_an_already_scoped_key_unchanged(self, browse) -> None:
        """The explorer sends absolute keys; double-prefixing breaks every click."""
        module, _ = browse

        scoped, error = module.scope_key_to_root(
            'raw-responses/2026/08/openai.json', 'raw-responses/'
        )

        assert scoped == 'raw-responses/2026/08/openai.json'
        assert error is None

    def test_scopes_a_cross_prefix_key_into_the_requested_root(self, browse) -> None:
        """A screenshots key requested against the responses bucket is contained."""
        module, _ = browse

        scoped, _ = module.scope_key_to_root('screenshots/shot.png', 'raw-responses/')

        assert scoped == 'raw-responses/screenshots/shot.png'

    def test_rejects_an_empty_key(self, browse) -> None:
        module, _ = browse

        scoped, error = module.scope_key_to_root('', 'raw-responses/')

        assert scoped is None
        assert error == 'key is required'

    def test_uses_the_screenshots_root_for_the_screenshots_bucket(self, browse) -> None:
        module, _ = browse

        scoped, _ = module.scope_key_to_root('2026/08/shot.png', 'screenshots/')

        assert scoped == 'screenshots/2026/08/shot.png'


class TestFileRouteContainment:
    """GET /file must never read outside the configured prefix."""

    def test_reads_an_already_scoped_key_verbatim(self, browse) -> None:
        module, s3 = browse

        status, _ = _request(module, '/file', _SCOPED_KEY)

        assert status == 200
        assert s3.get_object.call_args.kwargs == {
            'Bucket': RESPONSES_BUCKET,
            'Key': _SCOPED_KEY,
        }

    def test_scopes_a_relative_key_before_reading(self, browse) -> None:
        module, s3 = browse

        _request(module, '/file', '2026/08/openai.json')

        assert s3.get_object.call_args.kwargs['Key'] == 'raw-responses/2026/08/openai.json'

    def test_confines_a_key_pointing_at_another_prefix(self, browse) -> None:
        """
        REGRESSION: `key=citation-exports/secrets.json` used to be read verbatim,
        reaching any object in the bucket.
        """
        module, s3 = browse

        _request(module, '/file', 'citation-exports/secrets.json')

        assert s3.get_object.call_args.kwargs['Key'] == (
            'raw-responses/citation-exports/secrets.json'
        )

    def test_rejects_a_traversing_key(self, browse) -> None:
        module, s3 = browse

        status, body = _request(module, '/file', '../other/secrets.json')

        assert status == 400
        assert body['field'] == 'key'
        assert s3.get_object.call_count == 0

    def test_rejects_a_percent_encoded_traversing_key(self, browse) -> None:
        """Unquote runs before validation, so the encoded form is caught too."""
        module, s3 = browse

        status, _ = _request(module, '/file', '%2e%2e%2fsecrets.json')

        assert status == 400
        assert s3.get_object.call_count == 0

    def test_uses_the_screenshots_root_when_that_bucket_is_requested(self, browse) -> None:
        module, s3 = browse

        _request(module, '/file', '2026/08/shot.png', bucket='screenshots')

        assert s3.get_object.call_args.kwargs == {
            'Bucket': SCREENSHOTS_BUCKET,
            'Key': 'screenshots/2026/08/shot.png',
        }


class TestDownloadRouteContainment:
    """
    GET /download is the sharp end: whatever key reaches `generate_presigned_url`
    becomes a credential-free, shareable 15-minute URL.
    """

    def test_signs_an_already_scoped_key_verbatim(self, browse) -> None:
        module, s3 = browse

        status, _ = _request(module, '/download', _SCOPED_KEY)

        assert status == 200
        assert signed_key(s3) == _SCOPED_KEY

    def test_scopes_a_relative_key_before_signing(self, browse) -> None:
        module, s3 = browse

        _request(module, '/download', '2026/08/openai.json')

        assert signed_key(s3) == 'raw-responses/2026/08/openai.json'

    def test_never_signs_an_object_outside_the_root_prefix(self, browse) -> None:
        """REGRESSION: the headline of §2.7."""
        module, s3 = browse

        _request(module, '/download', 'citation-exports/secrets.json')

        assert signed_key(s3).startswith('raw-responses/')

    def test_rejects_a_traversing_key_without_signing_anything(self, browse) -> None:
        module, s3 = browse

        status, _ = _request(module, '/download', '../secrets.json')

        assert status == 400
        assert s3.generate_presigned_url.call_count == 0

    def test_echoes_the_key_that_was_actually_signed(self, browse) -> None:
        """Returning the raw input would misreport what the URL grants."""
        module, _ = browse

        _, body = _request(module, '/download', '2026/08/openai.json')

        assert body['key'] == 'raw-responses/2026/08/openai.json'

    def test_signs_screenshots_against_the_screenshots_bucket(self, browse) -> None:
        module, s3 = browse

        _request(module, '/download', 'shot.png', bucket='screenshots')

        assert s3.generate_presigned_url.call_args.kwargs['Params'] == {
            'Bucket': SCREENSHOTS_BUCKET,
            'Key': 'screenshots/shot.png',
        }


class TestBrowseRouteUnchanged:
    """The listing route already scoped correctly; the fix must not disturb it."""

    def test_lists_the_root_prefix_when_no_prefix_is_given(self, browse) -> None:
        module, s3 = browse

        assert listed_prefix(module, s3, '') == 'raw-responses/'

    def test_prepends_the_root_prefix_to_a_relative_prefix(self, browse) -> None:
        module, s3 = browse

        assert listed_prefix(module, s3, '2026/08') == 'raw-responses/2026/08/'


@pytest.mark.parametrize('route', ['/file', '/download'])
class TestObjectRouteParameters:
    """The ``key`` / ``bucket`` schema shared by /file and /download."""

    @pytest.mark.parametrize(('query', 'expected'), [
        pytest.param(
            {'bucket': 'responses'},
            {'error': 'Missing required field: key', 'field': 'key'},
            id='missing-key',
        ),
        pytest.param(
            {'key': 'k' * 1025},
            {'error': 'key too long (max 1024 characters)', 'field': 'key'},
            id='key-over-1024-characters',
        ),
        pytest.param(
            {'key': '2026/08/openai.json', 'bucket': 'b' * 21},
            {'error': 'bucket too long (max 20 characters)', 'field': 'bucket'},
            id='bucket-over-20-characters',
        ),
    ])
    def test_rejects_an_invalid_parameter_with_its_field(self, browse, route, query, expected) -> None:
        module, _ = browse

        assert _get(module, route, query) == (400, expected)

    def test_accepts_a_key_of_exactly_1024_characters(self, browse, route) -> None:
        module, _ = browse

        status, _ = _request(module, route, 'k' * 1024)

        assert status == 200

    @pytest.mark.parametrize(('key', 'bucket', 'expected'), [
        pytest.param(
            ' 2026/08/openai.json ', 'responses',
            {'Bucket': RESPONSES_BUCKET, 'Key': 'raw-responses/2026/08/openai.json'},
            id='padded-key',
        ),
        pytest.param(
            'shot.png', ' screenshots ',
            {'Bucket': SCREENSHOTS_BUCKET, 'Key': 'screenshots/shot.png'},
            id='padded-bucket',
        ),
    ])
    def test_trims_surrounding_spaces_before_addressing_the_object(self, browse, route, key, bucket, expected) -> None:
        module, s3 = browse

        _request(module, route, key, bucket)

        assert addressed_object(s3, route) == expected
