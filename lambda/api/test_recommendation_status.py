"""
Tests for recommendation-status.py — POST/GET /recommendations/{id}/status.

Covers:
- Validation: missing id, invalid status, oversized notes
- POST sets status, includes ttl + updated_at
- POST status=done populates completed_at
- GET returns the row, 404 when missing
- list_statuses degrades gracefully when env var is missing
"""

import os
import time
from types import ModuleType
from typing import Any, NamedTuple
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))


class Loaded(NamedTuple):
    """The freshly loaded handler, its status table and the DynamoDB resource it batch-reads from."""

    mod: ModuleType
    table: MagicMock
    ddb: MagicMock


@pytest.fixture
def loaded() -> Loaded:
    """Load recommendation-status.py with boto3 patched out."""
    mock_table = MagicMock()
    mock_dynamodb = fake_dynamodb_resource(mock_table)
    # batch_get_item lives on the resource itself
    mock_dynamodb.batch_get_item.return_value = {'Responses': {}}

    with (
        patch.dict(os.environ, {'RECOMMENDATION_STATUS_TABLE': 'test-rec-status'}),
        patch('boto3.resource', return_value=mock_dynamodb),
    ):
        mod = load_handler_module(_API_DIR, 'recommendation-status.py')

    # The module bound `dynamodb` and RECOMMENDATION_STATUS_TABLE while those
    # patches were active, so every later call already goes to the mock.
    return Loaded(mod, mock_table, mock_dynamodb)


def _status_event(method: str, rec_id: str, body: Any = None) -> dict[str, Any]:
    """A request addressing recommendation ``rec_id``; an empty id sends no path parameters."""
    return api_gateway_event(
        method,
        f'/api/recommendations/{rec_id}/status',
        resource='/api/recommendations/{id}/status',
        path_params={'id': rec_id} if rec_id else {},
        body=body,
    )


def _post_event(rec_id: str, body: Any) -> dict[str, Any]:
    return _status_event('POST', rec_id, body)


def _raw_post(raw_body: str) -> dict[str, Any]:
    """A POST for `abc` carrying ``raw_body`` verbatim."""
    return {**_post_event('abc', {}), 'body': raw_body}


def _posted_item(loaded: Loaded, body: dict[str, Any], rec_id: str = 'abc') -> dict[str, Any]:
    """The row a POST of ``body`` writes."""
    loaded.mod.handler(_post_event(rec_id, body), None)
    return loaded.table.put_item.call_args.kwargs['Item']


def _batch_returns(loaded: Loaded, *items: dict[str, Any]) -> None:
    """Make BatchGetItem answer with ``items`` from the status table."""
    loaded.ddb.batch_get_item.return_value = {'Responses': {loaded.table.name: list(items)}}


# --- validation ------------------------------------------------------------


@pytest.mark.parametrize('event', [
    pytest.param(_post_event('', {'status': 'done'}), id='post-path-id-missing'),
    pytest.param(_post_event('abc', {'status': 'sideways'}), id='status-unknown'),
    pytest.param(_post_event('abc', {}), id='status-missing'),
    pytest.param(_post_event('abc', {'status': 'done', 'notes': 'x' * 5000}), id='notes-exceeds-max-length'),
    pytest.param(_post_event('abc', {'status': 'done', 'related_keyword': 'x' * 1000}), id='related-keyword-exceeds-max-length'),
    pytest.param(_raw_post('{not-json'), id='body-invalid-json'),
    pytest.param(_raw_post('[]'), id='body-a-json-array'),
    pytest.param(_status_event('GET', ''), id='get-path-id-missing'),
])
def test_returns_400_when_the_request_is_invalid(loaded, event):
    assert loaded.mod.handler(event, None)['statusCode'] == 400


# --- POST persists ---------------------------------------------------------


def test_post_persists_status_with_updated_at_and_ttl(loaded):
    result = loaded.mod.handler(_post_event('abc', {'status': 'in_progress'}), None)
    assert result['statusCode'] == 200
    loaded.table.put_item.assert_called_once()
    item = loaded.table.put_item.call_args.kwargs['Item']
    assert item['recommendation_id'] == 'abc'
    assert item['status'] == 'in_progress'
    assert item['updated_at'].endswith('Z')


def test_post_sets_ttl_approximately_90_days_in_the_future(loaded):
    item = _posted_item(loaded, {'status': 'in_progress'})
    expected_ttl = int(time.time()) + 90 * 24 * 60 * 60
    # Allow a 60-second drift between test setup and assertion.
    assert abs(item['ttl'] - expected_ttl) < 60


def test_post_response_body_contains_the_persisted_item(loaded):
    _, body = parse_response(loaded.mod.handler(_post_event('abc', {'status': 'done'}), None))
    assert body['recommendation_id'] == 'abc'
    assert body['status'] == 'done'
    assert 'completed_at' in body


def test_post_done_status_sets_completed_at(loaded):
    assert 'completed_at' in _posted_item(loaded, {'status': 'done'}, 'xyz')


def test_post_in_progress_does_not_set_completed_at(loaded):
    assert 'completed_at' not in _posted_item(loaded, {'status': 'in_progress'}, 'xyz')


def test_post_persists_optional_notes_and_relationship_pointers(loaded):
    item = _posted_item(loaded, {
        'status': 'in_progress',
        'notes': 'reaching out next week',
        'related_keyword': 'best running shoes',
        'related_content_id': 'content-42',
    })
    assert item['notes'] == 'reaching out next week'
    assert item['related_keyword'] == 'best running shoes'
    assert item['related_content_id'] == 'content-42'


# --- GET ------------------------------------------------------------------


def test_get_returns_200_with_the_stored_status_row(loaded):
    row = {
        'recommendation_id': 'abc',
        'status': 'done',
        'updated_at': '2026-05-15T10:00:00Z',
        'notes': 'pitched',
    }
    loaded.table.get_item.return_value = {'Item': row}

    assert parse_response(loaded.mod.handler(_status_event('GET', 'abc'), None)) == (200, row)


def test_get_returns_404_when_no_row_exists(loaded):
    loaded.table.get_item.return_value = {}
    result = loaded.mod.handler(_status_event('GET', 'abc'), None)
    assert result['statusCode'] == 404


# --- list_statuses --------------------------------------------------------


def test_list_statuses_returns_empty_dict_when_table_unconfigured(loaded):
    loaded.mod.RECOMMENDATION_STATUS_TABLE = None
    assert loaded.mod.list_statuses(['abc', 'def']) == {}


def test_list_statuses_calls_batch_get_and_keys_by_recommendation_id(loaded):
    _batch_returns(
        loaded,
        {'recommendation_id': 'abc', 'status': 'done'},
        {'recommendation_id': 'xyz', 'status': 'in_progress'},
    )
    out = loaded.mod.list_statuses(['abc', 'xyz', 'missing'])
    assert out['abc']['status'] == 'done'
    assert out['xyz']['status'] == 'in_progress'
    assert 'missing' not in out


def test_list_statuses_returns_empty_dict_for_empty_input(loaded):
    assert loaded.mod.list_statuses([]) == {}


# --- method routing -------------------------------------------------------


def test_handler_returns_405_for_unsupported_method(loaded):
    result = loaded.mod.handler(_status_event('PUT', 'abc'), None)
    assert result['statusCode'] == 405


# --- additional coverage gaps --------------------------------------------


def test_table_helper_raises_runtime_error_when_env_var_unset(loaded):
    loaded.mod.RECOMMENDATION_STATUS_TABLE = None
    with pytest.raises(RuntimeError):
        loaded.mod._table()


def test_list_statuses_skips_response_items_without_recommendation_id(loaded):
    # If DynamoDB returns a response item missing the partition key (data
    # corruption / partial scan response), `list_statuses` should skip it
    # rather than insert an empty key into the result map.
    _batch_returns(
        loaded,
        {'status': 'done'},
        {'recommendation_id': 'good', 'status': 'in_progress'},
    )
    out = loaded.mod.list_statuses(['good', 'phantom'])
    assert list(out.keys()) == ['good']


def test_list_statuses_returns_partial_results_when_a_chunk_fails(loaded):
    # The auxiliary status feature is non-fatal: if BatchGetItem raises,
    # we keep going so recommendations still render without status.

    class BatchGetError(Exception):
        pass

    loaded.ddb.batch_get_item.side_effect = BatchGetError('throttled')
    assert loaded.mod.list_statuses(['abc']) == {}
