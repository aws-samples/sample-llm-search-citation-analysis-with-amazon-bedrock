"""
REGRESSION: the research poll must read its row by id, not search a scanned
history page.

Covers:
    - `GET /api/keyword-research/{id}` reads the row with `get_item` on the
      partition key and never falls back to `scan`, so the result it returns
      does not depend on how many rows the table holds.
    - Absent rows answer 404, and a missing id is a validation error, so the
      client can tell "not ready / gone" from "malformed request".
    - The reader-side stale sweep runs here too: a non-terminal row that has
      outlived the worker budget is reported `failed` instead of keeping the
      client polling to exhaustion.
    - Route order in `_route_handler`: the literal `/history` list route still
      wins over the parametric `('GET', None)` route.

Context:
    The UI polls for a background expansion/competitor run. It used to look for
    its id inside `GET /keyword-research/history?type=…&limit=50`. That list is
    a DynamoDB `scan` with a `Limit`, and DynamoDB applies `Limit` *before*
    `FilterExpression`, so the scanned window is an arbitrary slice of the
    table in partition-key hash order — not the newest rows by `created_at`,
    which `_get_history` only sorts *after* the fact. Once a table held more
    rows than that window, a freshly completed row was frequently absent from
    the page the poll inspected, the poll ran out its 40 attempts, and the UI
    reported "Research request timed out" for a run that had in fact written
    `status='completed'`. Table volume alone decided it, which is why the
    failure only appeared on installations with real usage history and never
    on a fresh deployment.

Test outcomes:
    - EXPECTED ON UNFIXED CODE: these tests FAIL at import/attribute lookup —
      `_get_research` does not exist and no `('GET', None)` route is
      registered, so a GET on the parametric path matched nothing.
    - After the fix: the poll resolves from a single `get_item` regardless of
      table size, and `scan` is never reached on this path.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

os.environ.setdefault('KEYWORD_RESEARCH_TABLE', 'test-keyword-research')

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
for _path in (_LAMBDA_DIR, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from shared.utils import get_timestamp

_spec = importlib.util.spec_from_file_location(
    'keyword_research_poll_under_test', os.path.join(_HERE, 'keyword-research.py')
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['keyword_research_poll_under_test'] = _mod
_spec.loader.exec_module(_mod)


def _completed_row(research_id: str = 'job-1') -> dict:
    return {
        'id': research_id,
        'type': 'expansion',
        'status': 'completed',
        'seed_keyword': 'hoteles en Lugo',
        'industry': 'Hotels & Hospitality',
        'keyword_count': 1,
        'created_at': get_timestamp(),
        'keywords': [{'keyword': 'hoteles Lugo centro', 'relevance': 9}],
    }


def _get_event(research_id: str | None) -> dict:
    path_params = {'id': research_id} if research_id is not None else {}
    suffix = research_id if research_id is not None else ''
    return {
        'httpMethod': 'GET',
        'resource': '/api/keyword-research/{id}',
        'path': f'/api/keyword-research/{suffix}',
        'pathParameters': path_params,
    }


def _table_returning(item: dict | None) -> MagicMock:
    table = MagicMock()
    table.get_item.return_value = {'Item': item} if item is not None else {}
    return table


def _body(response: dict) -> dict:
    return json.loads(response['body'])


class TestReadByIdNotByScan:
    """The poll's read must be keyed, so table volume cannot hide the row."""

    def test_reads_the_row_with_get_item_on_the_requested_id(self):
        table = _table_returning(_completed_row('job-42'))

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('job-42'), None)

        table.get_item.assert_called_once_with(Key={'id': 'job-42'})
        assert response['statusCode'] == 200

    def test_never_scans_the_table(self):
        """`scan` is the operation whose bounded window caused the bug."""
        table = _table_returning(_completed_row())

        with patch.object(_mod, 'research_table', table):
            _mod._get_research(_get_event('job-1'), None)

        table.scan.assert_not_called()

    def test_returns_the_stored_row_payload(self):
        table = _table_returning(_completed_row('job-7'))

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('job-7'), None)

        body = _body(response)
        assert body['id'] == 'job-7'
        assert body['status'] == 'completed'
        assert body['keywords'] == [{'keyword': 'hoteles Lugo centro', 'relevance': 9}]

    def test_omits_the_raw_provider_payload(self):
        """Mirrors the list view: no client reads `raw_response` from a poll."""
        row = _completed_row()
        row['raw_response'] = 'x' * 5000
        table = _table_returning(row)

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('job-1'), None)

        assert 'raw_response' not in _body(response)


class TestMissingRows:
    def test_absent_row_is_404(self):
        table = _table_returning(None)

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('does-not-exist'), None)

        assert response['statusCode'] == 404

    def test_missing_id_is_a_validation_error(self):
        table = _table_returning(None)

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event(None), None)

        assert response['statusCode'] == 400
        table.get_item.assert_not_called()


class TestStaleSweepOnRead:
    """A SIGKILLed worker leaves a non-terminal row; the reader resolves it."""

    @pytest.mark.parametrize('stranded_status', ['pending', 'processing'])
    def test_row_past_the_worker_budget_is_reported_failed(self, stranded_status):
        row = _completed_row()
        row['status'] = stranded_status
        row['created_at'] = '2020-01-01T00:00:00.000000Z'
        table = _table_returning(row)

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('job-1'), None)

        body = _body(response)
        assert body['status'] == 'failed'
        assert 'timed out' in body['error_message']

    def test_row_within_budget_keeps_its_status(self):
        row = _completed_row()
        row['status'] = 'processing'
        row['created_at'] = get_timestamp()
        table = _table_returning(row)

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event('job-1'), None)

        assert _body(response)['status'] == 'processing'


class TestRouteOrder:
    """`('GET', None)` matches any path, so `/history` must be declared first."""

    def test_history_path_still_reaches_the_list_view(self):
        table = MagicMock()
        table.scan.return_value = {'Items': []}
        event = {
            'httpMethod': 'GET',
            'resource': '/api/keyword-research/history',
            'path': '/api/keyword-research/history',
            'queryStringParameters': {'type': 'expansion', 'limit': '50'},
        }

        with patch.object(_mod, 'research_table', table):
            response = _mod._route_handler(event, None)

        assert response['statusCode'] == 200
        assert 'items' in _body(response)
        table.get_item.assert_not_called()

    def test_parametric_path_reaches_the_single_row_read(self):
        table = _table_returning(_completed_row('job-9'))

        with patch.object(_mod, 'research_table', table):
            response = _mod._route_handler(_get_event('job-9'), None)

        assert response['statusCode'] == 200
        assert _body(response)['id'] == 'job-9'
        table.scan.assert_not_called()

    def test_delete_on_the_parametric_path_still_deletes(self):
        table = MagicMock()
        event = _get_event('job-9')
        event['httpMethod'] = 'DELETE'

        with patch.object(_mod, 'research_table', table):
            response = _mod._route_handler(event, None)

        assert response['statusCode'] == 200
        table.delete_item.assert_called_once_with(Key={'id': 'job-9'})


class TestKeyedReadProperty:
    """**Property: the read is keyed by exactly the requested id.**

    Whatever the id, the handler issues one `get_item` for that key and never
    widens the read. This is the invariant that makes the poll independent of
    table size.
    """

    @given(research_id=st.text(
        alphabet=st.characters(blacklist_categories=('Cc', 'Cs'), blacklist_characters='/'),
        min_size=1,
        max_size=64,
    ))
    @settings(max_examples=50)
    def test_any_id_is_read_by_key_and_never_scanned(self, research_id):
        table = _table_returning(_completed_row(research_id))

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_research(_get_event(research_id), None)

        table.get_item.assert_called_once_with(Key={'id': research_id})
        table.scan.assert_not_called()
        assert response['statusCode'] == 200
