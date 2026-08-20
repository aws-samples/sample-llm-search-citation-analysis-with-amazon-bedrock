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

import importlib
import importlib.util
import json
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_API_DIR, '..'))
_MODULE_NAME = 'browse_raw_responses_under_test'

RESPONSES_BUCKET = 'test-raw-responses'
SCREENSHOTS_BUCKET = 'test-screenshots'

_TEST_ENV = {
    'RAW_RESPONSES_BUCKET': RESPONSES_BUCKET,
    'SCREENSHOTS_BUCKET': SCREENSHOTS_BUCKET,
    'CORS_ORIGIN_PARAM': '',
}


def _load_handler() -> tuple[Any, MagicMock]:
    """Import the hyphenated handler module with S3 mocked at import time."""
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')

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

    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, 'browse-raw-responses.py')
    )
    module = importlib.util.module_from_spec(spec)

    with patch('boto3.client', return_value=s3), patch.dict(os.environ, _TEST_ENV):
        spec.loader.exec_module(module)

    module.s3_client = s3
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


def make_event(route: str, key: str, bucket: str = 'responses') -> dict[str, Any]:
    """Build an API Gateway event for /file or /download."""
    return {
        'httpMethod': 'GET',
        'path': f'/api/raw-responses{route}',
        'headers': {'origin': 'http://localhost:3000'},
        'queryStringParameters': {
            'key': key,
            'bucket': bucket,
        },
    }


def parse_response(result: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Extract status code and parsed body from a Lambda response."""
    raw = result.get('body')
    parsed = json.loads(raw) if isinstance(raw, str) and raw else {}
    return result.get('statusCode', 200), parsed


def signed_key(s3: MagicMock) -> str:
    """Return the key from the most recent presigned-URL call."""
    return s3.generate_presigned_url.call_args.kwargs['Params']['Key']


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
        key = 'raw-responses/2026/08/openai.json'

        status, _ = parse_response(module.handler(make_event('/file', key), None))

        assert status == 200
        assert s3.get_object.call_args.kwargs == {
            'Bucket': RESPONSES_BUCKET,
            'Key': key,
        }

    def test_scopes_a_relative_key_before_reading(self, browse) -> None:
        module, s3 = browse

        module.handler(make_event('/file', '2026/08/openai.json'), None)

        assert s3.get_object.call_args.kwargs['Key'] == 'raw-responses/2026/08/openai.json'

    def test_confines_a_key_pointing_at_another_prefix(self, browse) -> None:
        """
        REGRESSION: `key=citation-exports/secrets.json` used to be read verbatim,
        reaching any object in the bucket.
        """
        module, s3 = browse

        module.handler(make_event('/file', 'citation-exports/secrets.json'), None)

        assert s3.get_object.call_args.kwargs['Key'] == (
            'raw-responses/citation-exports/secrets.json'
        )

    def test_rejects_a_traversing_key(self, browse) -> None:
        module, s3 = browse

        status, body = parse_response(
            module.handler(make_event('/file', '../other/secrets.json'), None)
        )

        assert status == 400
        assert body['field'] == 'key'
        assert s3.get_object.call_count == 0

    def test_rejects_a_percent_encoded_traversing_key(self, browse) -> None:
        """Unquote runs before validation, so the encoded form is caught too."""
        module, s3 = browse

        status, _ = parse_response(
            module.handler(make_event('/file', '%2e%2e%2fsecrets.json'), None)
        )

        assert status == 400
        assert s3.get_object.call_count == 0

    def test_uses_the_screenshots_root_when_that_bucket_is_requested(self, browse) -> None:
        module, s3 = browse

        module.handler(make_event('/file', '2026/08/shot.png', bucket='screenshots'), None)

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
        key = 'raw-responses/2026/08/openai.json'

        status, _ = parse_response(module.handler(make_event('/download', key), None))

        assert status == 200
        assert signed_key(s3) == key

    def test_scopes_a_relative_key_before_signing(self, browse) -> None:
        module, s3 = browse

        module.handler(make_event('/download', '2026/08/openai.json'), None)

        assert signed_key(s3) == 'raw-responses/2026/08/openai.json'

    def test_never_signs_an_object_outside_the_root_prefix(self, browse) -> None:
        """REGRESSION: the headline of §2.7."""
        module, s3 = browse

        module.handler(make_event('/download', 'citation-exports/secrets.json'), None)

        assert signed_key(s3).startswith('raw-responses/')

    def test_rejects_a_traversing_key_without_signing_anything(self, browse) -> None:
        module, s3 = browse

        status, _ = parse_response(
            module.handler(make_event('/download', '../secrets.json'), None)
        )

        assert status == 400
        assert s3.generate_presigned_url.call_count == 0

    def test_echoes_the_key_that_was_actually_signed(self, browse) -> None:
        """Returning the raw input would misreport what the URL grants."""
        module, _ = browse

        _, body = parse_response(
            module.handler(make_event('/download', '2026/08/openai.json'), None)
        )

        assert body['key'] == 'raw-responses/2026/08/openai.json'

    def test_signs_screenshots_against_the_screenshots_bucket(self, browse) -> None:
        module, s3 = browse

        module.handler(make_event('/download', 'shot.png', bucket='screenshots'), None)

        assert s3.generate_presigned_url.call_args.kwargs['Params'] == {
            'Bucket': SCREENSHOTS_BUCKET,
            'Key': 'screenshots/shot.png',
        }


class TestBrowseRouteUnchanged:
    """The listing route already scoped correctly; the fix must not disturb it."""

    def test_lists_the_root_prefix_when_no_prefix_is_given(self, browse) -> None:
        module, s3 = browse
        s3.list_objects_v2.return_value = {}
        event = {
            'httpMethod': 'GET',
            'path': '/api/raw-responses/browse',
            'headers': {},
            'queryStringParameters': {'prefix': ''},
        }

        module.handler(event, None)

        assert s3.list_objects_v2.call_args.kwargs['Prefix'] == 'raw-responses/'

    def test_prepends_the_root_prefix_to_a_relative_prefix(self, browse) -> None:
        module, s3 = browse
        s3.list_objects_v2.return_value = {}
        event = {
            'httpMethod': 'GET',
            'path': '/api/raw-responses/browse',
            'headers': {},
            'queryStringParameters': {'prefix': '2026/08'},
        }

        module.handler(event, None)

        assert s3.list_objects_v2.call_args.kwargs['Prefix'] == 'raw-responses/2026/08/'
