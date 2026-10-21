"""Tests for shared.response_spill: the S3 safety net under Lambda's 6 MiB response cap."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared import response_spill
from shared.api_response import api_response
from shared.response_budget import LAMBDA_RESPONSE_LIMIT_BYTES, SPILL_THRESHOLD_BYTES, envelope_bytes
from testing.response_size import long_text

PRESIGNED_URL = 'https://citation-analysis-keywords-123.s3.amazonaws.com/api-responses/x.json?X-Amz-Signature=abc'
EVENT = {'httpMethod': 'GET', 'resource': '/api/citations', 'headers': {}}


@pytest.fixture
def s3_client() -> Iterator[MagicMock]:
    client = MagicMock()
    client.generate_presigned_url.return_value = PRESIGNED_URL
    with patch.object(response_spill, '_s3', return_value=client), \
         patch.dict(os.environ, {response_spill.BUCKET_ENV: 'citation-analysis-keywords-123'}):
        yield client


def _oversized_body() -> dict[str, Any]:
    # 4.5M characters of accented text: about 4.8 MB of UTF-8, over 6 MiB once escaped twice.
    return {'top_urls': [long_text(4_500_000)]}


def _decoded(response: dict[str, Any]) -> Any:
    return json.loads(response['body'])


def test_returns_small_responses_unchanged(s3_client: MagicMock) -> None:
    response = {'statusCode': 200, 'headers': {}, 'body': '{"ok": true}'}

    assert response_spill.guard_response(response, EVENT) is response
    s3_client.put_object.assert_not_called()


def test_the_oversized_fixture_would_exceed_the_lambda_cap() -> None:
    body = json.dumps(_oversized_body())

    assert envelope_bytes({'statusCode': 200, 'headers': {}, 'body': body}) > LAMBDA_RESPONSE_LIMIT_BYTES


def test_spills_an_oversized_body_to_s3_under_the_spill_prefix(s3_client: MagicMock) -> None:
    api_response(200, _oversized_body(), EVENT)

    put = s3_client.put_object.call_args.kwargs
    assert (put['Bucket'], put['Key'].startswith('api-responses/'), put['ContentType']) == (
        'citation-analysis-keywords-123', True, 'application/json',
    )


def test_spilled_object_holds_the_original_body(s3_client: MagicMock) -> None:
    api_response(200, _oversized_body(), EVENT)

    assert json.loads(s3_client.put_object.call_args.kwargs['Body'].decode('utf-8')) == _oversized_body()


def test_answers_a_pointer_with_the_presigned_url_and_original_status(s3_client: MagicMock) -> None:
    response = api_response(201, _oversized_body(), EVENT)

    pointer = _decoded(response)['spilled_response']
    assert (response['statusCode'], pointer['url'], pointer['expires_in']) == (201, PRESIGNED_URL, 300)


def test_marks_the_pointer_with_the_spill_header(s3_client: MagicMock) -> None:
    response = api_response(200, _oversized_body(), EVENT)

    assert response['headers']['X-Spilled-Response'] == 'true'


def test_reports_the_measured_envelope_size_in_the_pointer(s3_client: MagicMock) -> None:
    response = api_response(200, _oversized_body(), EVENT)

    assert _decoded(response)['spilled_response']['size_bytes'] >= SPILL_THRESHOLD_BYTES


def test_presigns_a_short_lived_get_of_the_spilled_object(s3_client: MagicMock) -> None:
    api_response(200, _oversized_body(), EVENT)

    key = s3_client.put_object.call_args.kwargs['Key']
    s3_client.generate_presigned_url.assert_called_once_with(
        'get_object', Params={'Bucket': 'citation-analysis-keywords-123', 'Key': key}, ExpiresIn=300,
    )


def test_answers_a_clear_500_when_the_bucket_is_not_configured(s3_client: MagicMock) -> None:
    with patch.dict(os.environ, {}, clear=True):
        response = api_response(200, _oversized_body(), EVENT)

    assert (response['statusCode'], _decoded(response)['code']) == (500, 'response_too_large')


def test_answers_a_clear_500_when_s3_rejects_the_write(s3_client: MagicMock) -> None:
    s3_client.put_object.side_effect = ClientError({'Error': {'Code': 'AccessDenied'}}, 'PutObject')

    response = api_response(200, _oversized_body(), EVENT)

    assert (response['statusCode'], _decoded(response)['code']) == (500, 'response_too_large')


def test_logs_each_spill_as_an_error_with_route_and_size(s3_client: MagicMock, caplog: pytest.LogCaptureFixture) -> None:
    api_response(200, _oversized_body(), EVENT)

    assert any(
        record.levelname == 'ERROR' and record.getMessage().startswith('spilled_api_response route=GET /api/citations bytes=')
        for record in caplog.records
    )


def test_warns_about_large_responses_below_the_threshold(s3_client: MagicMock, caplog: pytest.LogCaptureFixture) -> None:
    api_response(200, {'text': long_text(1_000_000)}, EVENT)

    assert [record.getMessage().split(' bytes=')[0] for record in caplog.records if record.levelname == 'WARNING'] == [
        'large_api_response route=GET /api/citations',
    ]
    s3_client.put_object.assert_not_called()


def test_finds_the_url_of_a_spill_pointer() -> None:
    body = {'spilled_response': {'url': PRESIGNED_URL, 'size_bytes': 7, 'expires_in': 300}}

    assert response_spill.spilled_location(body) == PRESIGNED_URL


@pytest.mark.parametrize('body', [
    {'spilled_response': {'url': 'http://insecure.example/x'}},
    {'spilled_response': {'url': PRESIGNED_URL}, 'other': 1},
    {'spilled_response': 'not an object'},
    {'top_urls': []},
    ['spilled_response'],
    None,
])
def test_ignores_bodies_that_are_not_a_secure_spill_pointer(body: Any) -> None:
    assert response_spill.spilled_location(body) is None
