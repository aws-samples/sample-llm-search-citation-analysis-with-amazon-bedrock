"""Tests for ordinary and authoritative keyword retrieval."""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, call, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_API_DIR, '..'))
_MODULE_NAME = 'get_keywords_under_test'
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'


def _load_handler():
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, 'get-keywords.py')
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def get_keywords_handler():
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ[name] = _TEST_TABLE_NAME

    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch('boto3.resource', return_value=resource):
        module = _load_handler()

    yield module, table

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_MODULE_NAME, None)


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


def test_returns_all_501_keywords_when_authoritative_scan_crosses_default_page_size(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    keywords = [_keyword(index) for index in range(501)]
    continuation_key = {'id': keywords[499]['id']}
    table.scan.side_effect = [
        {'Items': keywords[:500], 'LastEvaluatedKey': continuation_key},
        {'Items': keywords[500:]},
    ]

    status_code, body = _invoke(module, {'authoritative': 'true', 'limit': '1'})

    assert status_code == 200
    assert body == {
        'keywords': list(reversed(keywords)),
        'count': 501,
        'complete': True,
    }
    assert table.scan.call_args_list == [
        call(ConsistentRead=True),
        call(ConsistentRead=True, ExclusiveStartKey=continuation_key),
    ]


def test_uses_each_exact_last_evaluated_key_when_authoritative_scan_continues(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    first_key = {'id': 'first-page-last', 'tenant': 'tenant-a'}
    second_key = {'id': 'second-page-last', 'tenant': 'tenant-b'}
    table.scan.side_effect = [
        {'Items': [], 'LastEvaluatedKey': first_key},
        {'Items': [], 'LastEvaluatedKey': second_key},
        {'Items': []},
    ]

    status_code, _body = _invoke(module, {'authoritative': 'true'})

    assert status_code == 200
    assert table.scan.call_args_list == [
        call(ConsistentRead=True),
        call(ConsistentRead=True, ExclusiveStartKey=first_key),
        call(ConsistentRead=True, ExclusiveStartKey=second_key),
    ]


def test_uses_consistent_read_on_every_page_when_request_is_authoritative(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    table.scan.side_effect = [
        {'Items': [], 'LastEvaluatedKey': {'id': 'page-one'}},
        {'Items': [], 'LastEvaluatedKey': {'id': 'page-two'}},
        {'Items': []},
    ]

    _invoke(module, {'authoritative': 'true'})

    assert [scan.kwargs['ConsistentRead'] for scan in table.scan.call_args_list] == [
        True,
        True,
        True,
    ]


def test_returns_later_matches_when_authoritative_filtered_page_is_empty(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    continuation_key = {'id': 'empty-filtered-page-last'}
    matching_keyword = _keyword(7)
    table.scan.side_effect = [
        {'Items': [], 'LastEvaluatedKey': continuation_key},
        {'Items': [matching_keyword]},
    ]
    filter_params = {
        'ConsistentRead': True,
        'FilterExpression': '#status = :status',
        'ExpressionAttributeValues': {':status': 'active'},
        'ExpressionAttributeNames': {'#status': 'status'},
    }

    status_code, body = _invoke(
        module, {'authoritative': 'true', 'status': 'active'}
    )

    assert status_code == 200
    assert body == {
        'keywords': [matching_keyword],
        'count': 1,
        'complete': True,
    }
    assert table.scan.call_args_list == [
        call(**filter_params),
        call(**filter_params, ExclusiveStartKey=continuation_key),
    ]


def test_returns_globally_sorted_counted_complete_result_when_page_timestamps_interleave(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    oldest = _keyword(10)
    middle = _keyword(20)
    newest = _keyword(30)
    table.scan.side_effect = [
        {
            'Items': [middle, oldest],
            'LastEvaluatedKey': {'id': 'first-page-last'},
        },
        {'Items': [newest]},
    ]

    status_code, body = _invoke(module, {'authoritative': 'true'})

    assert status_code == 200
    assert body == {
        'keywords': [newest, middle, oldest],
        'count': 3,
        'complete': True,
    }


def test_returns_existing_one_page_shape_when_authoritative_is_omitted(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    older = _keyword(1)
    newer = _keyword(2)
    table.scan.side_effect = [
        {
            'Items': [older, newer],
            'LastEvaluatedKey': {'id': newer['id']},
        },
        {'Items': [_keyword(3)]},
    ]

    status_code, body = _invoke(module)

    assert status_code == 200
    assert body == {'keywords': [newer, older], 'count': 2}
    table.scan.assert_called_once_with(Limit=500)


def test_uses_existing_maximum_limit_when_authoritative_is_false(
    get_keywords_handler,
):
    module, table = get_keywords_handler
    table.scan.return_value = {'Items': []}

    status_code, body = _invoke(
        module, {'authoritative': 'false', 'limit': '1000'}
    )

    assert status_code == 200
    assert body == {'keywords': [], 'count': 0}
    table.scan.assert_called_once_with(Limit=1000)


def test_rejects_values_above_existing_limit_maximum_when_request_is_ordinary(
    get_keywords_handler,
):
    module, table = get_keywords_handler

    status_code, body = _invoke(module, {'limit': '1001'})

    assert status_code == 400
    assert body == {'error': 'limit must be at most 1000', 'field': 'limit'}
    table.scan.assert_not_called()
