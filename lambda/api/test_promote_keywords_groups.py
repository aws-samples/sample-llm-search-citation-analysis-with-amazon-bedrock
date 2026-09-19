"""Focused tests for destination-group behavior during keyword promotion."""

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import conditional_check_failure, fake_dynamodb_resource, reset_tables
from testing.env import KEYWORDS_TABLE_ENV
from testing.module_loader import load_handler_module

mock_keywords_table = MagicMock()
mock_groups_table = MagicMock()
mock_dynamodb = fake_dynamodb_resource(
    mock_keywords_table,
    by_name={'test-keyword-groups': mock_groups_table},
)

with patch('boto3.resource', return_value=mock_dynamodb), patch.dict(os.environ, {
    **KEYWORDS_TABLE_ENV,
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
    'CORS_ORIGIN_PARAM': '',
}):
    _mod = load_handler_module(
        os.path.dirname(__file__),
        'promote-keywords.py',
        'promote_keywords_with_groups',
    )


def _invoke(keywords, group_ids=None):
    body = {'keywords': keywords}
    if group_ids is not None:
        body['group_ids'] = group_ids
    event = {
        'httpMethod': 'POST',
        'path': '/api/keywords/promote',
        'headers': {},
        'body': json.dumps(body),
    }
    response = _mod.handler(event, None)
    return response['statusCode'], json.loads(response['body'])


# What promoting the already-stored "Hotel Coruña" answers when no group was attached to it.
_HOTEL_CORUNA_ALREADY_STORED = {
    'created': 0,
    'skipped': 1,
    'created_keywords': [],
    'skipped_keywords': [{'keyword': 'Hotel Coruña', 'reason': 'duplicate'}],
    'grouped_keywords': [],
}


@pytest.fixture(autouse=True)
def _reset_mocks():
    reset_tables(mock_keywords_table, mock_groups_table)
    mock_keywords_table.scan.return_value = {'Items': []}
    mock_keywords_table.put_item.return_value = {}
    mock_groups_table.get_item.side_effect = lambda Key: {'Item': {'id': Key['id']}}


def test_unions_destination_group_under_stored_legacy_id_when_keyword_exists():
    previous = {
        'id': 'legacy-random-id',
        'keyword': 'Hotel Coruña',
        'group_ids': {'existing-group'},
    }
    mock_keywords_table.scan.return_value = {'Items': [previous]}
    mock_keywords_table.update_item.return_value = {'Attributes': previous}

    status, body = _invoke([{'keyword': '  hotel coruña  '}], ['destination-group'])

    assert status == 200
    assert body['grouped_keywords'] == ['hotel coruña']
    mock_keywords_table.update_item.assert_called_once_with(
        Key={'id': 'legacy-random-id'},
        UpdateExpression='ADD group_ids :gids',
        ConditionExpression='attribute_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
        ExpressionAttributeValues={':gids': {'destination-group'}},
        ReturnValues='ALL_OLD',
    )
    mock_keywords_table.put_item.assert_not_called()


def test_reports_existing_outcome_when_destination_membership_already_exists():
    previous = {
        'id': 'legacy-random-id',
        'keyword': 'Hotel Coruña',
        'group_ids': {'destination-group'},
    }
    mock_keywords_table.scan.return_value = {'Items': [previous]}
    mock_keywords_table.update_item.return_value = {'Attributes': previous}

    status, body = _invoke([{'keyword': 'Hotel Coruña'}], ['destination-group'])

    assert status == 200
    assert body == _HOTEL_CORUNA_ALREADY_STORED


def test_attaches_destination_group_when_conditional_create_loses():
    mock_keywords_table.put_item.side_effect = conditional_check_failure('PutItem', message='duplicate')
    mock_keywords_table.update_item.return_value = {'Attributes': {
        'id': 'winner-id',
        'keyword': 'new keyword',
    }}

    status, body = _invoke([{'keyword': 'new keyword'}], ['destination-group'])

    candidate_id = mock_keywords_table.put_item.call_args.kwargs['Item']['id']
    assert status == 200
    assert body['grouped_keywords'] == ['new keyword']
    assert mock_keywords_table.update_item.call_args.kwargs['Key'] == {'id': candidate_id}
    assert body['skipped_keywords'] == [{'keyword': 'new keyword', 'reason': 'duplicate'}]


def test_leaves_existing_keyword_unchanged_when_group_ids_omitted():
    mock_keywords_table.scan.return_value = {'Items': [{
        'id': 'legacy-random-id',
        'keyword': 'Hotel Coruña',
    }]}

    status, body = _invoke([{'keyword': 'Hotel Coruña'}])

    assert status == 200
    assert body == _HOTEL_CORUNA_ALREADY_STORED
    mock_keywords_table.update_item.assert_not_called()


def test_creates_grouped_keyword_when_keyword_does_not_exist():
    status, body = _invoke([{'keyword': 'new keyword'}], ['destination-group'])

    written = mock_keywords_table.put_item.call_args.kwargs['Item']
    assert status == 200
    assert body['created'] == 1
    assert body['grouped_keywords'] == []
    assert written['group_ids'] == {'destination-group'}


def test_accepts_more_than_fifty_destination_groups_when_keyword_is_created():
    destination_groups = [f'group-{index}' for index in range(51)]

    status, _body = _invoke([{'keyword': 'new keyword'}], destination_groups)

    written = mock_keywords_table.put_item.call_args.kwargs['Item']
    assert status == 200
    assert written['group_ids'] == set(destination_groups)
