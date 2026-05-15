"""
Tests for recommendation-status.py — POST/GET /recommendations/{id}/status.

Covers:
- Validation: missing id, invalid status, oversized notes
- POST sets status, includes ttl + updated_at
- POST status=done populates completed_at
- GET returns the row, 404 when missing
- list_statuses degrades gracefully when env var is missing
"""

import importlib
import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Mount shared layer / fall back to lambda/ source tree.
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')
_LAMBDA_DIR = os.path.join(_REPO, 'lambda')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.insert(0, _LAYER_PY)
elif _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

_layer_api_response = importlib.import_module('shared.api_response')
sys.modules['shared.api_response'] = _layer_api_response

_API_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_module():
    """Load recommendation-status.py with boto3 patched out."""
    mock_table = MagicMock()
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = mock_table
    # batch_get_item lives on the resource itself
    mock_dynamodb.batch_get_item.return_value = {'Responses': {}}

    spec = importlib.util.spec_from_file_location(
        'recommendation_status_under_test',
        os.path.join(_API_DIR, 'recommendation-status.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules['recommendation_status_under_test'] = mod

    with patch.dict(os.environ, {
        'RECOMMENDATION_STATUS_TABLE': 'test-rec-status',
    }):
        with patch('boto3.resource', return_value=mock_dynamodb):
            spec.loader.exec_module(mod)

    # Override the module-level dynamodb reference so subsequent
    # invocations use the mock too.
    mod.dynamodb = mock_dynamodb
    mod.RECOMMENDATION_STATUS_TABLE = 'test-rec-status'
    return mod, mock_table, mock_dynamodb


@pytest.fixture
def loaded():
    return _load_module()


def _post_event(rec_id, body):
    return {
        'httpMethod': 'POST',
        'resource': '/api/recommendations/{id}/status',
        'path': f'/api/recommendations/{rec_id}/status',
        'pathParameters': {'id': rec_id},
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body),
    }


def _get_event(rec_id):
    return {
        'httpMethod': 'GET',
        'resource': '/api/recommendations/{id}/status',
        'path': f'/api/recommendations/{rec_id}/status',
        'pathParameters': {'id': rec_id},
        'headers': {'origin': 'http://localhost:3000'},
        'body': None,
    }


# --- validation ------------------------------------------------------------


def test_post_returns_400_when_path_id_missing(loaded):
    mod, _table, _ddb = loaded
    event = _post_event('', {'status': 'done'})
    event['pathParameters'] = {}
    result = mod.handler(event, None)
    assert result['statusCode'] == 400


def test_post_returns_400_when_status_is_unknown(loaded):
    mod, _table, _ddb = loaded
    result = mod.handler(_post_event('abc', {'status': 'sideways'}), None)
    assert result['statusCode'] == 400


def test_post_returns_400_when_status_is_missing(loaded):
    mod, _table, _ddb = loaded
    result = mod.handler(_post_event('abc', {}), None)
    assert result['statusCode'] == 400


def test_post_returns_400_when_notes_exceeds_max_length(loaded):
    mod, _table, _ddb = loaded
    over_limit = 'x' * 5000
    result = mod.handler(
        _post_event('abc', {'status': 'done', 'notes': over_limit}),
        None,
    )
    assert result['statusCode'] == 400


def test_post_returns_400_when_related_keyword_exceeds_max_length(loaded):
    mod, _table, _ddb = loaded
    over_limit = 'x' * 1000
    result = mod.handler(
        _post_event('abc', {'status': 'done', 'related_keyword': over_limit}),
        None,
    )
    assert result['statusCode'] == 400


def test_post_returns_400_when_body_is_invalid_json(loaded):
    mod, _table, _ddb = loaded
    event = _post_event('abc', {})
    event['body'] = '{not-json'
    result = mod.handler(event, None)
    assert result['statusCode'] == 400


def test_post_returns_400_when_body_is_a_json_array(loaded):
    mod, _table, _ddb = loaded
    event = _post_event('abc', {})
    event['body'] = '[]'
    result = mod.handler(event, None)
    assert result['statusCode'] == 400


# --- POST persists ---------------------------------------------------------


def test_post_persists_status_with_updated_at_and_ttl(loaded):
    mod, table, _ddb = loaded
    result = mod.handler(_post_event('abc', {'status': 'in_progress'}), None)
    assert result['statusCode'] == 200
    table.put_item.assert_called_once()
    item = table.put_item.call_args.kwargs['Item']
    assert item['recommendation_id'] == 'abc'
    assert item['status'] == 'in_progress'
    assert item['updated_at'].endswith('Z')


def test_post_sets_ttl_approximately_90_days_in_the_future(loaded):
    import time
    mod, table, _ddb = loaded
    mod.handler(_post_event('abc', {'status': 'in_progress'}), None)
    item = table.put_item.call_args.kwargs['Item']
    expected_ttl = int(time.time()) + 90 * 24 * 60 * 60
    # Allow a 60-second drift between test setup and assertion.
    assert abs(item['ttl'] - expected_ttl) < 60


def test_post_response_body_contains_the_persisted_item(loaded):
    mod, table, _ddb = loaded
    result = mod.handler(_post_event('abc', {'status': 'done'}), None)
    body = json.loads(result['body'])
    assert body['recommendation_id'] == 'abc'
    assert body['status'] == 'done'
    assert 'completed_at' in body


def test_post_done_status_sets_completed_at(loaded):
    mod, table, _ddb = loaded
    mod.handler(_post_event('xyz', {'status': 'done'}), None)
    item = table.put_item.call_args.kwargs['Item']
    assert 'completed_at' in item


def test_post_in_progress_does_not_set_completed_at(loaded):
    mod, table, _ddb = loaded
    mod.handler(_post_event('xyz', {'status': 'in_progress'}), None)
    item = table.put_item.call_args.kwargs['Item']
    assert 'completed_at' not in item


def test_post_persists_optional_notes_and_relationship_pointers(loaded):
    mod, table, _ddb = loaded
    body = {
        'status': 'in_progress',
        'notes': 'reaching out next week',
        'related_keyword': 'best running shoes',
        'related_content_id': 'content-42',
    }
    mod.handler(_post_event('abc', body), None)
    item = table.put_item.call_args.kwargs['Item']
    assert item['notes'] == 'reaching out next week'
    assert item['related_keyword'] == 'best running shoes'
    assert item['related_content_id'] == 'content-42'


# --- GET ------------------------------------------------------------------


def test_get_returns_200_with_existing_row(loaded):
    mod, table, _ddb = loaded
    table.get_item.return_value = {
        'Item': {'recommendation_id': 'abc', 'status': 'done'},
    }
    result = mod.handler(_get_event('abc'), None)
    assert result['statusCode'] == 200


def test_get_response_body_contains_status_row_fields(loaded):
    mod, table, _ddb = loaded
    table.get_item.return_value = {
        'Item': {
            'recommendation_id': 'abc',
            'status': 'done',
            'updated_at': '2026-05-15T10:00:00Z',
            'notes': 'pitched',
        },
    }
    result = mod.handler(_get_event('abc'), None)
    body = json.loads(result['body'])
    assert body['status'] == 'done'
    assert body['notes'] == 'pitched'


def test_get_returns_404_when_no_row_exists(loaded):
    mod, table, _ddb = loaded
    table.get_item.return_value = {}
    result = mod.handler(_get_event('abc'), None)
    assert result['statusCode'] == 404


# --- list_statuses --------------------------------------------------------


def test_list_statuses_returns_empty_dict_when_table_unconfigured(loaded):
    mod, _table, _ddb = loaded
    mod.RECOMMENDATION_STATUS_TABLE = None
    out = mod.list_statuses(['abc', 'def'])
    assert out == {}


def test_list_statuses_calls_batch_get_and_keys_by_recommendation_id(loaded):
    mod, table, ddb = loaded
    ddb.batch_get_item.return_value = {
        'Responses': {
            table.name: [
                {'recommendation_id': 'abc', 'status': 'done'},
                {'recommendation_id': 'xyz', 'status': 'in_progress'},
            ],
        },
    }
    out = mod.list_statuses(['abc', 'xyz', 'missing'])
    assert out['abc']['status'] == 'done'
    assert out['xyz']['status'] == 'in_progress'
    assert 'missing' not in out


def test_list_statuses_returns_empty_dict_for_empty_input(loaded):
    mod, _table, _ddb = loaded
    out = mod.list_statuses([])
    assert out == {}


# --- method routing -------------------------------------------------------


def test_handler_returns_405_for_unsupported_method(loaded):
    mod, _table, _ddb = loaded
    event = _get_event('abc')
    event['httpMethod'] = 'PUT'
    result = mod.handler(event, None)
    assert result['statusCode'] == 405


# --- additional coverage gaps --------------------------------------------


def test_get_returns_400_when_path_id_missing(loaded):
    mod, _table, _ddb = loaded
    event = _get_event('')
    event['pathParameters'] = {}
    result = mod.handler(event, None)
    assert result['statusCode'] == 400


def test_table_helper_raises_runtime_error_when_env_var_unset(loaded):
    mod, _table, _ddb = loaded
    mod.RECOMMENDATION_STATUS_TABLE = None
    with pytest.raises(RuntimeError):
        mod._table()


def test_list_statuses_skips_response_items_without_recommendation_id(loaded):
    # If DynamoDB returns a response item missing the partition key (data
    # corruption / partial scan response), `list_statuses` should skip it
    # rather than insert an empty key into the result map.
    mod, table, ddb = loaded
    ddb.batch_get_item.return_value = {
        'Responses': {
            table.name: [
                {'status': 'done'},  # missing recommendation_id
                {'recommendation_id': 'good', 'status': 'in_progress'},
            ],
        },
    }
    out = mod.list_statuses(['good', 'phantom'])
    assert list(out.keys()) == ['good']


def test_list_statuses_returns_partial_results_when_a_chunk_fails(loaded):
    # The auxiliary status feature is non-fatal: if BatchGetItem raises,
    # we keep going so recommendations still render without status.
    mod, _table, ddb = loaded

    class BatchGetError(Exception):
        pass

    ddb.batch_get_item.side_effect = BatchGetError('throttled')
    out = mod.list_statuses(['abc'])
    assert out == {}
