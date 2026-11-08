"""Tests for testing.snapshot_fakes: the conditional S3 bucket behaves like S3's ETag preconditions."""

from __future__ import annotations

import pytest
from botocore.exceptions import ClientError

from testing.snapshot_fakes import ConditionalS3

KEY = 'scope-snapshots/keywords/abc.json.gz'


def _error_code(error: pytest.ExceptionInfo[ClientError]) -> str:
    return error.value.response.get('Error', {}).get('Code', '')


def test_put_returns_the_etag_get_reads_back() -> None:
    bucket = ConditionalS3()

    etag = bucket.put_object(Key=KEY, Body=b'{"v":1}')['ETag']

    assert (bucket.get_object(Key=KEY)['ETag'], bucket.get_object(Key=KEY)['Body'].read()) == (etag, b'{"v":1}')


def test_put_with_the_current_etag_replaces_the_object() -> None:
    bucket = ConditionalS3()
    etag = bucket.put_object(Key=KEY, Body=b'one')['ETag']

    bucket.put_object(Key=KEY, Body=b'two', IfMatch=etag)

    assert bucket.get_object(Key=KEY)['Body'].read() == b'two'


def test_put_with_a_stale_etag_is_precondition_failed() -> None:
    bucket = ConditionalS3()
    stale = bucket.put_object(Key=KEY, Body=b'one')['ETag']
    bucket.put_object(Key=KEY, Body=b'two')

    with pytest.raises(ClientError) as error:
        bucket.put_object(Key=KEY, Body=b'three', IfMatch=stale)

    assert (_error_code(error), bucket.get_object(Key=KEY)['Body'].read()) == ('PreconditionFailed', b'two')


def test_put_if_match_on_a_missing_key_is_precondition_failed() -> None:
    with pytest.raises(ClientError) as error:
        ConditionalS3().put_object(Key=KEY, Body=b'one', IfMatch='"abc"')

    assert _error_code(error) == 'PreconditionFailed'


def test_put_if_none_match_creates_only_once() -> None:
    bucket = ConditionalS3()
    bucket.put_object(Key=KEY, Body=b'first', IfNoneMatch='*')

    with pytest.raises(ClientError) as error:
        bucket.put_object(Key=KEY, Body=b'second', IfNoneMatch='*')

    assert (_error_code(error), bucket.get_object(Key=KEY)['Body'].read()) == ('PreconditionFailed', b'first')


def test_get_if_none_match_of_the_same_version_is_not_modified() -> None:
    bucket = ConditionalS3()
    etag = bucket.put_object(Key=KEY, Body='text')['ETag']

    with pytest.raises(ClientError) as error:
        bucket.get_object(Key=KEY, IfNoneMatch=etag)

    assert _error_code(error) == '304'


def test_get_if_match_of_another_version_is_precondition_failed() -> None:
    bucket = ConditionalS3()
    bucket.put_object(Key=KEY, Body=b'one')

    with pytest.raises(ClientError) as error:
        bucket.get_object(Key=KEY, IfMatch='"other"')

    assert _error_code(error) == 'PreconditionFailed'


def test_get_of_a_missing_key_is_no_such_key() -> None:
    with pytest.raises(ClientError) as error:
        ConditionalS3().get_object(Key=KEY)

    assert _error_code(error) == 'NoSuchKey'


def test_head_reports_size_and_etag_without_a_read() -> None:
    bucket = ConditionalS3()
    etag = bucket.put_object(Key=KEY, Body=b'12345')['ETag']

    assert (bucket.head_object(Key=KEY), bucket.gets, bucket.heads) == ({'ETag': etag, 'ContentLength': 5}, [], [KEY])


def test_delete_removes_the_object() -> None:
    bucket = ConditionalS3()
    bucket.put_object(Key=KEY, Body=b'one')

    bucket.delete_object(Key=KEY)

    assert bucket.etag_of(KEY) is None


def test_every_call_is_recorded_in_order() -> None:
    bucket = ConditionalS3()
    bucket.put_object(Key='a', Body=b'1')
    bucket.put_object(Key='b', Body=b'2')
    bucket.get_object(Key='b')

    assert (bucket.puts, bucket.gets) == (['a', 'b'], ['b'])
