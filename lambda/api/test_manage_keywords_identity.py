"""Identity and conditional-write tests for manual keyword management."""

import os
from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError

from testing.dynamodb_stubs import conditional_check_failure, fake_table
from testing.env import KEYWORDS_TABLE_ENV
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

_FULLWIDTH_ALPHA = ''.join(chr(code_point) for code_point in (
    0xFF21,
    0xFF2C,
    0xFF30,
    0xFF28,
    0xFF21,
))


_ALREADY_EXISTS = (409, {'error': 'Keyword already exists'})
_NOT_FOUND = (404, {'error': 'Keyword not found'})

manage_module = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'manage-keywords.py', 'manage_keywords_under_test_identity',
    env=KEYWORDS_TABLE_ENV, scope='function',
)


@pytest.fixture
def manage_handler(manage_module):
    """`manage-keywords.py`, loaded per test, and a table with no stored keywords."""
    return manage_module, fake_table(scan={'Items': []})


def _invoke(module, table, method, body=None, keyword_id=None):
    event = api_gateway_event(
        method,
        '/api/keywords' if keyword_id is None else f'/api/keywords/{keyword_id}',
        body=body,
        path_params={} if keyword_id is None else {'id': keyword_id},
        headers={},
    )
    with patch.object(module, 'keywords_table', table):
        return parse_response(module.handler(event, None))


def _store_alpha(table, status='active'):
    """Store "alpha" under ``alpha-id`` with ``status``; returns the stored row."""
    existing = {'id': 'alpha-id', 'keyword': 'alpha', 'status': status}
    table.get_item.return_value = {'Item': existing}
    return existing


def _update_alpha(module, table, body):
    return _invoke(module, table, 'PUT', body, keyword_id='alpha-id')


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

    assert _invoke(module, table, 'POST', {'keyword': 'alpha'}) == _ALREADY_EXISTS
    table.put_item.assert_not_called()


def test_returns_409_when_concurrent_create_occupies_deterministic_id(manage_handler):
    module, table = manage_handler
    table.put_item.side_effect = conditional_check_failure('PutItem')

    assert _invoke(module, table, 'POST', {'keyword': 'alpha'}) == _ALREADY_EXISTS


def test_returns_400_before_dynamodb_when_manual_keyword_has_lone_surrogate(manage_handler):
    module, table = manage_handler

    status_code, body = _invoke(module, table, 'POST', {'keyword': '\ud800'})

    assert status_code == 400
    assert body['field'] == 'keyword'
    table.scan.assert_not_called()
    table.put_item.assert_not_called()


def test_returns_409_without_update_when_canonical_keyword_identity_changes(manage_handler):
    module, table = manage_handler
    _store_alpha(table)

    status_code, body = _update_alpha(module, table, {'keyword': 'beta'})

    assert status_code == 409
    assert 'identity cannot be changed' in body['error']
    table.update_item.assert_not_called()


def test_returns_409_when_the_keyword_changes_before_the_conditional_update_lands(manage_handler):
    module, table = manage_handler
    _store_alpha(table)
    table.update_item.side_effect = conditional_check_failure()

    assert _update_alpha(module, table, {'keyword': 'alpha'}) == (
        409, {'error': 'Keyword changed while it was being updated'},
    )


def test_updates_display_text_when_canonical_keyword_identity_is_unchanged(manage_handler):
    module, table = manage_handler
    updated = {**_store_alpha(table), 'keyword': _FULLWIDTH_ALPHA}
    table.update_item.return_value = {'Attributes': updated}

    status_code, body = _update_alpha(module, table, {'keyword': f'\uFEFF{_FULLWIDTH_ALPHA}\u0085'})

    assert status_code == 200
    assert body == updated
    assert table.update_item.call_args.kwargs['ConditionExpression'] == (
        'attribute_exists(#id) AND #kw = :expected_keyword'
    )
    assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':k'] == (
        _FULLWIDTH_ALPHA
    )


def test_leaves_a_paused_keyword_paused_when_the_update_omits_status(manage_handler):
    """REGRESSION: an edit that says nothing about status must not activate.

    `status` defaulted to 'active' and was written on every update, so renaming
    a paused keyword resurrected it — and an active keyword is queried against
    every provider on the next run, so the rename quietly added spend. Research
    promotes unselected proposals as inactive, which is exactly the population a
    rename would have activated.
    """
    module, table = manage_handler
    existing = _store_alpha(table, 'inactive')
    table.update_item.return_value = {'Attributes': existing}

    status_code, _ = _update_alpha(module, table, {'keyword': 'alpha'})

    assert status_code == 200
    kwargs = table.update_item.call_args.kwargs
    assert ':st' not in kwargs['ExpressionAttributeValues']
    assert '#s' not in kwargs['UpdateExpression']


def test_sets_status_when_the_update_asks_for_one(manage_handler):
    module, table = manage_handler
    existing = _store_alpha(table, 'inactive')
    table.update_item.return_value = {'Attributes': {**existing, 'status': 'active'}}

    status_code, body = _update_alpha(module, table, {'keyword': 'alpha', 'status': 'active'})

    assert status_code == 200
    assert body['status'] == 'active'
    assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':st'] == 'active'


def test_rejects_an_unknown_status_without_updating(manage_handler):
    module, table = manage_handler
    _store_alpha(table)

    status_code, _ = _update_alpha(module, table, {'keyword': 'alpha', 'status': 'archived'})

    assert status_code == 400
    table.update_item.assert_not_called()


def test_returns_404_without_update_when_keyword_id_is_missing(manage_handler):
    module, table = manage_handler
    table.get_item.return_value = {}

    assert _invoke(module, table, 'PUT', {'keyword': 'alpha'}, keyword_id='missing-id') == _NOT_FOUND
    table.update_item.assert_not_called()


def test_returns_404_when_delete_targets_missing_keyword(manage_handler):
    module, table = manage_handler
    table.delete_item.side_effect = conditional_check_failure('DeleteItem')

    assert _invoke(module, table, 'DELETE', keyword_id='missing-id') == _NOT_FOUND
    table.delete_item.assert_called_once_with(
        Key={'id': 'missing-id'},
        ConditionExpression='attribute_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
    )


def test_returns_sanitized_500_when_manual_create_has_service_failure(manage_handler):
    module, table = manage_handler
    table.put_item.side_effect = ClientError(
        {'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'write failed'}}, 'PutItem',
    )

    status_code, body = _invoke(module, table, 'POST', {'keyword': 'alpha'})

    assert status_code == 500
    assert body == {'error': 'Service temporarily unavailable'}
