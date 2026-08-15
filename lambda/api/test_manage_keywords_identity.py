"""Identity and conditional-write tests for manual keyword management."""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_API_DIR, '..'))
_MODULE_NAME = 'manage_keywords_under_test_identity'
_TABLE_ENV_VARS = ('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
_TEST_TABLE_NAME = 'test-keywords-table'
_FULLWIDTH_ALPHA = ''.join(chr(code_point) for code_point in (
    0xFF21,
    0xFF2C,
    0xFF30,
    0xFF28,
    0xFF21,
))


def _load_handler():
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, 'manage-keywords.py')
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def manage_handler():
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    for name in _TABLE_ENV_VARS:
        os.environ[name] = _TEST_TABLE_NAME

    table = MagicMock()
    table.scan.return_value = {'Items': []}
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


def _invoke(module, table, method, body=None, keyword_id=None):
    event = {
        'httpMethod': method,
        'path': '/api/keywords' if keyword_id is None else f'/api/keywords/{keyword_id}',
        'pathParameters': {} if keyword_id is None else {'id': keyword_id},
        'headers': {},
        'body': None if body is None else json.dumps(body),
    }
    with patch.object(module, 'keywords_table', table):
        response = module.handler(event, None)
    return response['statusCode'], json.loads(response['body'])


def _conditional_error(code='ConditionalCheckFailedException'):
    return ClientError({'Error': {'Code': code, 'Message': 'write failed'}}, 'PutItem')


def test_returns_deterministic_id_when_manual_keyword_is_created(manage_handler):
    module, table = manage_handler

    status_code, body = _invoke(module, table, 'POST', {'keyword': ' \tALPHA\u0085'})

    assert status_code == 201
    assert body['id'] == '4f0bb461-7bfc-5538-88ba-3d6a8aa99b5d'
    table.scan.assert_called_once_with(
        ProjectionExpression='#kw',
        ExpressionAttributeNames={'#kw': 'keyword'},
        ConsistentRead=True,
    )
    table.put_item.assert_called_once_with(
        Item=body,
        ConditionExpression='attribute_not_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
    )


def test_returns_409_without_writing_when_legacy_row_has_same_identity(manage_handler):
    module, table = manage_handler
    table.scan.return_value = {
        'Items': [{'keyword': f'\uFEFF{_FULLWIDTH_ALPHA}\u0085'}]
    }

    status_code, body = _invoke(module, table, 'POST', {'keyword': 'alpha'})

    assert status_code == 409
    assert body == {'error': 'Keyword already exists'}
    table.put_item.assert_not_called()


def test_returns_409_when_concurrent_create_occupies_deterministic_id(manage_handler):
    module, table = manage_handler
    table.put_item.side_effect = _conditional_error()

    status_code, body = _invoke(module, table, 'POST', {'keyword': 'alpha'})

    assert status_code == 409
    assert body == {'error': 'Keyword already exists'}


def test_returns_400_before_dynamodb_when_manual_keyword_has_lone_surrogate(manage_handler):
    module, table = manage_handler

    status_code, body = _invoke(module, table, 'POST', {'keyword': '\ud800'})

    assert status_code == 400
    assert body['field'] == 'keyword'
    table.scan.assert_not_called()
    table.put_item.assert_not_called()


def test_returns_409_without_update_when_canonical_keyword_identity_changes(manage_handler):
    module, table = manage_handler
    table.get_item.return_value = {
        'Item': {'id': 'alpha-id', 'keyword': 'alpha', 'status': 'active'}
    }

    status_code, body = _invoke(
        module, table, 'PUT', {'keyword': 'beta'}, keyword_id='alpha-id'
    )

    assert status_code == 409
    assert 'identity cannot be changed' in body['error']
    table.update_item.assert_not_called()


def test_updates_display_text_when_canonical_keyword_identity_is_unchanged(manage_handler):
    module, table = manage_handler
    existing = {'id': 'alpha-id', 'keyword': 'alpha', 'status': 'active'}
    updated = {**existing, 'keyword': _FULLWIDTH_ALPHA}
    table.get_item.return_value = {'Item': existing}
    table.update_item.return_value = {'Attributes': updated}

    status_code, body = _invoke(
        module,
        table,
        'PUT',
        {'keyword': f'\uFEFF{_FULLWIDTH_ALPHA}\u0085'},
        keyword_id='alpha-id',
    )

    assert status_code == 200
    assert body == updated
    assert table.update_item.call_args.kwargs['ConditionExpression'] == (
        'attribute_exists(#id) AND #kw = :expected_keyword'
    )
    assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':k'] == (
        _FULLWIDTH_ALPHA
    )


def test_returns_404_without_update_when_keyword_id_is_missing(manage_handler):
    module, table = manage_handler
    table.get_item.return_value = {}

    status_code, body = _invoke(
        module, table, 'PUT', {'keyword': 'alpha'}, keyword_id='missing-id'
    )

    assert status_code == 404
    assert body == {'error': 'Keyword not found'}
    table.update_item.assert_not_called()


def test_returns_404_when_delete_targets_missing_keyword(manage_handler):
    module, table = manage_handler
    table.delete_item.side_effect = _conditional_error()

    status_code, body = _invoke(module, table, 'DELETE', keyword_id='missing-id')

    assert status_code == 404
    assert body == {'error': 'Keyword not found'}
    table.delete_item.assert_called_once_with(
        Key={'id': 'missing-id'},
        ConditionExpression='attribute_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
    )


def test_returns_sanitized_500_when_manual_create_has_service_failure(manage_handler):
    module, table = manage_handler
    table.put_item.side_effect = _conditional_error('ProvisionedThroughputExceededException')

    status_code, body = _invoke(module, table, 'POST', {'keyword': 'alpha'})

    assert status_code == 500
    assert body == {'error': 'Service temporarily unavailable'}
