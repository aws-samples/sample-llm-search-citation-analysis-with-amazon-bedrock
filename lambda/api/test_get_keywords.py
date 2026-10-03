"""Tests for paginated keyword retrieval (one scan page per request plus a continuation token)."""

import base64
import json
import os
from unittest.mock import MagicMock, patch

import pytest

from testing.env import KEYWORDS_TABLE_ENV
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_MODULE_NAME = 'get_keywords_under_test'
_INVALID_TOKEN_BODY = {'error': 'Invalid next_token', 'field': 'next_token'}


get_keywords_module = handler_fixture(_API_DIR, 'get-keywords.py', _MODULE_NAME, env=KEYWORDS_TABLE_ENV, scope='function')


@pytest.fixture
def get_keywords_handler(get_keywords_module):
    """`get-keywords.py`, loaded per test, reading a fresh mock keywords table."""
    table = MagicMock()
    with patch.object(get_keywords_module, 'keywords_table', table):
        yield get_keywords_module, table


def _invoke(module, query=None):
    event = {
        'httpMethod': 'GET',
        'path': '/api/keywords',
        'headers': {},
        'queryStringParameters': query,
    }
    response = module.handler(event, None)
    return response['statusCode'], json.loads(response['body'])


def _keyword(index):
    return {
        'id': f'keyword-{index:03d}',
        'keyword': f'keyword {index}',
        'created_at': f'2026-01-01T00:00:00.{index:06d}Z',
    }


def _raw_token(payload: str) -> str:
    return base64.urlsafe_b64encode(payload.encode('utf-8')).decode('ascii')


def test_returns_one_page_with_count_and_token_when_scan_has_more_pages(get_keywords_handler):
    module, table = get_keywords_handler
    page = [_keyword(1), _keyword(2)]
    table.scan.return_value = {'Items': page, 'LastEvaluatedKey': {'id': 'keyword-002'}}

    status_code, body = _invoke(module)

    assert status_code == 200
    assert body == {
        'keywords': page,
        'count': 2,
        'next_token': module.encode_next_token({'id': 'keyword-002'}),
    }


def test_resumes_scan_at_the_encoded_key_when_previous_token_is_sent_back(get_keywords_handler):
    module, table = get_keywords_handler
    last_key = {'id': 'keyword-500'}
    table.scan.side_effect = [
        {'Items': [_keyword(500)], 'LastEvaluatedKey': last_key},
        {'Items': [_keyword(501)]},
    ]

    _status, first_page = _invoke(module)
    _invoke(module, {'next_token': first_page['next_token']})

    assert table.scan.call_args_list[1].kwargs == {'Limit': 1000, 'ExclusiveStartKey': last_key}


def test_returns_null_token_when_scan_page_is_the_last(get_keywords_handler):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': [_keyword(7)]}

    _status, body = _invoke(module)

    assert body == {'keywords': [_keyword(7)], 'count': 1, 'next_token': None}


def test_returns_page_in_scan_order_when_timestamps_are_unsorted(get_keywords_handler):
    module, table = get_keywords_handler
    unsorted = [_keyword(1), _keyword(3), _keyword(2)]
    table.scan.return_value = {'Items': unsorted}

    _status, body = _invoke(module)

    assert [item['id'] for item in body['keywords']] == ['keyword-001', 'keyword-003', 'keyword-002']


def test_serializes_group_id_sets_as_sorted_lists_when_page_has_memberships(get_keywords_handler):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': [{**_keyword(1), 'group_ids': {'group-b', 'group-a'}}]}

    _status, body = _invoke(module)

    assert body['keywords'][0]['group_ids'] == ['group-a', 'group-b']


@pytest.mark.parametrize(
    'token',
    [
        pytest.param('!!!not-base64!!!', id='non-alphabet characters'),
        pytest.param(_raw_token('not json'), id='base64 of non-JSON'),
        pytest.param(_raw_token('["keyword-001"]'), id='JSON array'),
        pytest.param(_raw_token('{"id": 42}'), id='non-string id'),
        pytest.param(_raw_token('{"id": ""}'), id='empty id'),
        pytest.param(_raw_token('{"id": "a", "tenant": "b"}'), id='extra key attribute'),
        pytest.param(_raw_token('{"keyword": "a"}'), id='wrong key attribute'),
        pytest.param('', id='empty token'),
        pytest.param('Zm9v\u00e9', id='non-ASCII character'),
    ],
)
def test_rejects_request_with_400_when_next_token_is_malformed(get_keywords_handler, token):
    module, table = get_keywords_handler

    status_code, body = _invoke(module, {'next_token': token})

    assert (status_code, body) == (400, _INVALID_TOKEN_BODY)
    table.scan.assert_not_called()


def test_rejects_request_with_400_when_next_token_exceeds_max_length(get_keywords_handler):
    module, table = get_keywords_handler
    too_long = 'A' * (module.MAX_NEXT_TOKEN_LENGTH + 1)

    status_code, body = _invoke(module, {'next_token': too_long})

    assert status_code == 400
    assert body == {'error': 'next_token too long (max 1024 characters)', 'field': 'next_token'}
    table.scan.assert_not_called()


def test_forwards_filters_with_exclusive_start_key_when_filtered_request_continues(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': []}
    token = module.encode_next_token({'id': 'keyword-900'})

    _invoke(module, {'status': 'active', 'priority': 'high', 'group_id': 'group-a', 'next_token': token})

    table.scan.assert_called_once_with(
        Limit=1000,
        FilterExpression='#status = :status AND priority = :priority AND contains(group_ids, :group_id)',
        ExpressionAttributeValues={':status': 'active', ':priority': 'high', ':group_id': 'group-a'},
        ExpressionAttributeNames={'#status': 'status'},
        ExclusiveStartKey={'id': 'keyword-900'},
    )


def test_returns_token_for_empty_filtered_page_when_later_pages_may_match(get_keywords_handler):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': [], 'LastEvaluatedKey': {'id': 'keyword-999'}}

    _status, body = _invoke(module, {'group_id': 'group-a'})

    assert body == {
        'keywords': [],
        'count': 0,
        'next_token': module.encode_next_token({'id': 'keyword-999'}),
    }


def test_reads_one_consistent_page_when_request_is_authoritative(get_keywords_handler):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': [], 'LastEvaluatedKey': {'id': 'keyword-001'}}

    _invoke(module, {'authoritative': 'true', 'limit': '250'})

    table.scan.assert_called_once_with(Limit=250, ConsistentRead=True)


def test_uses_default_page_size_of_1000_when_limit_is_omitted(get_keywords_handler):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': []}

    _invoke(module)

    table.scan.assert_called_once_with(Limit=1000)


@pytest.mark.parametrize(
    ('limit', 'message'),
    [
        pytest.param('1001', 'limit must be at most 1000', id='above maximum'),
        pytest.param('0', 'limit must be at least 1', id='below minimum'),
        pytest.param('ten', 'Invalid type for limit: expected int', id='not an integer'),
    ],
)
def test_rejects_request_with_400_when_limit_is_out_of_range(get_keywords_handler, limit, message):
    module, table = get_keywords_handler

    status_code, body = _invoke(module, {'limit': limit})

    assert (status_code, body) == (400, {'error': message, 'field': 'limit'})
    table.scan.assert_not_called()


def test_round_trips_key_through_token_when_id_has_non_ascii_characters(get_keywords_handler):
    module, _table = get_keywords_handler
    key = {'id': 'hôtel-coruña/?&='}

    token = module.encode_next_token(key)

    assert module.decode_next_token(token) == key
