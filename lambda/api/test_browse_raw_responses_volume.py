"""Volume tests for GET /api/raw-responses/browse and /file.

Before: browse read ONE ListObjectsV2 page and never followed it, so a folder
with more than 1,000 entries was silently cut; /file read the whole object
inline, so a 6 MB raw provider answer (or a 2 MB one of accented text, after
JSON escaping) produced a response over the 6 MiB Lambda cap. Browse pages
then carried S3's continuation token, but S3 lists keys ascending, so past
1,000 entries the first page showed the OLDEST runs. Now browse reads the
whole folder (up to ``MAX_LISTED_ENTRIES``, within the time budget), sorts it
newest first and pages it with a token bound to the prefix and the last
entry's path; objects over 1 MB come back as a presigned download link.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.cursors import encode_cursor
from testing.assertions import present
from testing.deadlines import spent_deadline
from testing.events import api_gateway_event, parse_response
from testing.module_loader import API_DIR, load_handler_module
from testing.paging import INVALID_NEXT_TOKEN, follow_next_token
from testing.response_size import assert_within_page_budget, long_text

_ENV = {'RAW_RESPONSES_BUCKET': 'test-raw', 'SCREENSHOTS_BUCKET': 'test-shots', 'CORS_ORIGIN_PARAM': ''}

with patch('boto3.client', return_value=MagicMock()), patch.dict(os.environ, _ENV):
    _mod = load_handler_module(API_DIR, 'browse-raw-responses.py', 'browse_raw_volume')

_MODIFIED = datetime(2026, 9, 18, tzinfo=UTC)


_PREFIX = 'raw-responses/2026-09-18/'


def _s3_folder(file_count: int, folder_count: int = 0) -> MagicMock:
    """An S3 client listing one folder of ``raw-responses/2026-09-18/`` page by page (MaxKeys honoured)."""
    return _s3_listing(
        [('file', f'{_PREFIX}hotel-coruña-{n:05d}-openai.json') for n in range(file_count)]
        + [('folder', f'{_PREFIX}run-{n:04d}/') for n in range(folder_count)]
    )


def _s3_listing(entries: list[tuple[str, str]]) -> MagicMock:
    """An S3 client listing ``entries`` (``(kind, key)``, read on every call) ascending, as S3 does."""
    client = MagicMock()

    def list_objects_v2(**params: Any) -> dict[str, Any]:
        listed = sorted(entries, key=lambda entry: entry[1])
        start = int(params.get('ContinuationToken', '0'))
        page = listed[start:start + params['MaxKeys']]
        response: dict[str, Any] = {
            'Contents': [{'Key': key, 'Size': 4_096, 'LastModified': _MODIFIED} for kind, key in page if kind == 'file'],
            'CommonPrefixes': [{'Prefix': key} for kind, key in page if kind == 'folder'],
            'IsTruncated': start + len(page) < len(listed),
        }
        if response['IsTruncated']:
            response['NextContinuationToken'] = str(start + len(page))
        return response

    client.list_objects_v2.side_effect = list_objects_v2
    return client


def _paths(body: dict[str, Any]) -> list[str]:
    return [entry['path'] for entry in body['folders'] + body['files']]


def _browse(client: MagicMock, query: dict[str, str]) -> dict[str, Any]:
    event = api_gateway_event('GET', '/api/raw-responses/browse', query=query)
    with patch.object(_mod, 's3_client', client):
        return _mod.handler(event, None)


def _object_client(body: bytes) -> MagicMock:
    client = MagicMock()
    client.exceptions.NoSuchKey = type('NoSuchKey', (Exception,), {})
    client.generate_presigned_url.return_value = 'https://signed.example/object'
    stream = MagicMock()
    stream.read.return_value = body
    client.get_object.return_value = {
        'Body': stream, 'ContentLength': len(body), 'LastModified': _MODIFIED, 'ContentType': 'application/json',
    }
    return client


def _file(client: MagicMock) -> dict[str, Any]:
    event = api_gateway_event('GET', '/api/raw-responses/file', query={'key': 'raw-responses/2026-09-18/big.json'})
    with patch.object(_mod, 's3_client', client):
        return _mod.handler(event, None)


@pytest.fixture(scope='module')
def big_folder() -> MagicMock:
    return _s3_folder(4_500, folder_count=30)


def test_stays_within_page_budget_when_folder_holds_thousands_of_files(big_folder: MagicMock) -> None:
    response = _browse(big_folder, {'prefix': '2026-09-18/'})

    assert_within_page_budget(response)


def test_continues_with_next_token_when_folder_exceeds_one_s3_page(big_folder: MagicMock) -> None:
    _status, body = parse_response(_browse(big_folder, {'prefix': '2026-09-18/'}))

    assert (body['total_files'] + body['total_folders'], body['next_token'] is not None) == (1_000, True)


@settings(max_examples=15, deadline=None)
@given(st.integers(min_value=0, max_value=2_600), st.integers(min_value=0, max_value=5))
def test_following_next_token_returns_every_entry_once(file_count: int, folder_count: int) -> None:
    client = _s3_folder(file_count, folder_count)

    paths = follow_next_token(
        lambda query: _browse(client, query),
        {'prefix': '2026-09-18/'},
        _paths,
        max_pages=10,
    )

    assert (len(paths), len(set(paths))) == (file_count + folder_count, file_count + folder_count)


def test_rejects_next_token_issued_for_another_folder(big_folder: MagicMock) -> None:
    _status, first = parse_response(_browse(big_folder, {'prefix': '2026-09-18/'}))

    response = _browse(big_folder, {'prefix': '2026-09-17/', 'next_token': first['next_token']})

    assert parse_response(response) == INVALID_NEXT_TOKEN


def test_rejects_next_token_pointing_outside_its_folder(big_folder: MagicMock) -> None:
    token = present(encode_cursor({'prefix': _PREFIX, 'after': 'raw-responses/2026-09-17/run-0001/'}))

    response = _browse(big_folder, {'prefix': '2026-09-18/', 'next_token': token})

    assert parse_response(response) == INVALID_NEXT_TOKEN


@pytest.fixture(scope='module')
def big_folder_first_page(big_folder: MagicMock) -> dict[str, Any]:
    """The body of the first browse page of ``big_folder``."""
    return parse_response(_browse(big_folder, {'prefix': '2026-09-18/'}))[1]


def test_first_page_holds_the_newest_entries_when_folder_exceeds_one_s3_page(big_folder_first_page: dict[str, Any]) -> None:
    body = big_folder_first_page

    assert (body['folders'][0]['name'], body['files'][0]['name'], body['files'][-1]['name']) == (
        'run-0029', 'hotel-coruña-04499-openai.json', 'hotel-coruña-03530-openai.json',
    )


def test_counts_the_whole_folder_while_paging(big_folder_first_page: dict[str, Any]) -> None:
    body = big_folder_first_page

    assert (body['folder_count'], body['file_count'], body['truncated']) == (30, 4_500, False)


def test_following_next_token_lists_folders_then_files_newest_first(big_folder: MagicMock) -> None:
    paths = follow_next_token(lambda query: _browse(big_folder, query), {'prefix': '2026-09-18/'}, _paths, max_pages=10)

    folders, files = paths[:30], paths[30:]
    assert (folders, files) == (sorted(folders, reverse=True), sorted(files, reverse=True))


def test_newer_run_added_between_pages_does_not_repeat_entries() -> None:
    entries = [('folder', f'raw-responses/run-{n:05d}/') for n in range(1_500)]
    client = _s3_listing(entries)
    _status, first = parse_response(_browse(client, {}))

    entries.append(('folder', 'raw-responses/run-99999/'))
    _status, second = parse_response(_browse(client, {'next_token': first['next_token']}))

    paths = _paths(first) + _paths(second)
    assert (len(paths), len(set(paths)), second['next_token']) == (1_500, 1_500, None)


def test_says_truncated_when_folder_exceeds_the_listing_cap() -> None:
    client = _s3_folder(2_500)

    with patch.object(_mod, 'MAX_LISTED_ENTRIES', 2_000):
        _status, body = parse_response(_browse(client, {'prefix': '2026-09-18/'}))

    assert (body['file_count'], body['truncated'], client.list_objects_v2.call_count) == (2_000, True, 2)


def test_says_truncated_when_the_time_budget_runs_out(big_folder: MagicMock) -> None:
    with patch.object(_mod, 'current_deadline', return_value=spent_deadline()):
        _status, body = parse_response(_browse(big_folder, {'prefix': '2026-09-18/'}))

    assert (body['folder_count'] + body['file_count'], body['truncated']) == (1_000, True)


def test_rejects_malformed_next_token_with_400(big_folder: MagicMock) -> None:
    assert parse_response(_browse(big_folder, {'next_token': 'e30'})) == INVALID_NEXT_TOKEN


def test_stays_within_page_budget_when_raw_file_is_several_megabytes() -> None:
    client = _object_client(('{"answer": "' + long_text(6_000_000) + '"}').encode())

    response = _file(client)

    assert_within_page_budget(response)


def test_returns_download_link_instead_of_content_when_file_exceeds_inline_limit() -> None:
    client = _object_client(b'"' + b'x' * 1_000_001 + b'"')

    _status, body = parse_response(_file(client))

    assert (body['too_large'], body['content'], body['download_url']) == (True, None, 'https://signed.example/object')
    client.get_object.return_value['Body'].read.assert_not_called()


def test_returns_inline_content_when_file_is_at_inline_limit() -> None:
    client = _object_client(b'"' + b'x' * 999_998 + b'"')

    _status, body = parse_response(_file(client))

    assert (body['too_large'], body['is_json'], len(body['content'])) == (False, True, 999_998)
