"""
Tests for keyword-research.py status polling and history retrieval.

Context:
    The dashboard fires async keyword expansion / competitor analysis and then
    polls for the result. Polling previously hit GET /history, which runs a
    DynamoDB `scan` with `Limit` applied BEFORE the type `FilterExpression`.
    Once the research table grew past one scan page, the just-created record
    was frequently absent from the page, so the poll hung until timeout — the
    "super slow" symptom reported by users.

    The fix adds GET /status/{id} (an O(1) `get_item` point lookup) for polling
    and changes /history to page through all matching records, then sort and
    slice, so it never applies a pre-filter `Limit`.

These tests cover:
    - /status/{id} returns the record via point lookup (not a scan)
    - /status/{id} 404s for unknown ids and strips the bulky raw_response
    - /history sorts by created_at desc, never passes `Limit` to scan,
      applies the limit after sorting, and pages through LastEvaluatedKey
"""

import importlib.util
import json
import os
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# The Lambda layer normally puts shared/ at /opt/python/shared/. Put lambda/ on
# the path so `from shared.xxx import ...` resolves to lambda/shared.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/

# bs4 is only present in the crawler/api layers at runtime, not the unit-test
# venv. keyword-research.py imports it at module scope for page scraping, which
# the status/history paths never exercise — stub it so the module imports.
if 'bs4' not in sys.modules:
    _bs4_stub = types.ModuleType('bs4')
    _bs4_stub.BeautifulSoup = MagicMock()
    sys.modules['bs4'] = _bs4_stub

mock_table = MagicMock()
mock_dynamodb = MagicMock()
mock_dynamodb.Table.return_value = mock_table


def _mock_boto3_resource(*args, **kwargs):
    return mock_dynamodb


_handler_spec = importlib.util.spec_from_file_location(
    'keyword_research',
    os.path.join(os.path.dirname(__file__), 'keyword-research.py'),
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)

with patch('boto3.resource', side_effect=_mock_boto3_resource):
    with patch('boto3.client', return_value=MagicMock()):
        with patch.dict(os.environ, {'KEYWORD_RESEARCH_TABLE': 'test-table', 'CORS_ORIGIN_PARAM': ''}):
            _handler_spec.loader.exec_module(_handler_mod)

_handler_mod.research_table = mock_table


def make_event(method, path, path_params=None, query_params=None):
    """Build a minimal API Gateway event for the keyword-research router."""
    return {
        'httpMethod': method,
        'path': path,
        'pathParameters': path_params,
        'queryStringParameters': query_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': None,
    }


def parse_response(result):
    """Extract status code and parsed JSON body from a Lambda response."""
    status = result.get('statusCode', 200)
    body = json.loads(result['body']) if isinstance(result.get('body'), str) else result.get('body', {})
    return status, body


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset the DynamoDB mock between tests."""
    mock_table.reset_mock(return_value=True, side_effect=True)
    mock_table.get_item.return_value = {'Item': None}
    mock_table.scan.return_value = {'Items': []}


@pytest.fixture()
def handler_module():
    """Provide the handler module wired to the mocked DynamoDB table."""
    _handler_mod.research_table = mock_table
    yield _handler_mod


def _status_event(research_id):
    return make_event(
        'GET',
        f'/api/keyword-research/status/{research_id}',
        path_params={'id': research_id},
    )


class TestGetStatus:
    """GET /api/keyword-research/status/{id}."""

    def test_returns_completed_record_when_research_exists(self, handler_module):
        """A completed record is returned with status 200 and its keywords."""
        mock_table.get_item.return_value = {
            'Item': {
                'id': 'research-1',
                'type': 'expansion',
                'status': 'completed',
                'seed_keyword': 'best hotels',
                'keyword_count': 2,
                'keywords': [{'keyword': 'luxury hotels'}, {'keyword': 'cheap hotels'}],
            }
        }

        status, body = parse_response(handler_module.handler(_status_event('research-1'), {}))

        assert status == 200
        assert body['status'] == 'completed'
        assert body['keyword_count'] == 2
        assert [k['keyword'] for k in body['keywords']] == ['luxury hotels', 'cheap hotels']

    def test_returns_404_when_research_id_not_found(self, handler_module):
        """An unknown id yields a 404 not-found response."""
        mock_table.get_item.return_value = {'Item': None}

        status, body = parse_response(handler_module.handler(_status_event('missing'), {}))

        assert status == 404
        assert 'not found' in body['error'].lower()

    def test_looks_up_by_id_without_scanning_the_table(self, handler_module):
        """Polling uses an O(1) get_item on the id key, never a table scan."""
        mock_table.get_item.return_value = {'Item': {'id': 'research-2', 'status': 'processing'}}

        handler_module.handler(_status_event('research-2'), {})

        mock_table.get_item.assert_called_once_with(Key={'id': 'research-2'})
        mock_table.scan.assert_not_called()

    def test_omits_raw_response_from_status_payload(self, handler_module):
        """The bulky raw model response is stripped from the polling payload."""
        mock_table.get_item.return_value = {
            'Item': {'id': 'research-3', 'status': 'completed', 'raw_response': 'x' * 5000}
        }

        _, body = parse_response(handler_module.handler(_status_event('research-3'), {}))

        assert 'raw_response' not in body


class TestGetHistory:
    """GET /api/keyword-research/history."""

    def test_returns_items_sorted_by_created_at_descending(self, handler_module):
        """History is returned newest-first regardless of scan order."""
        mock_table.scan.return_value = {
            'Items': [
                {'id': 'old', 'created_at': '2024-01-01T00:00:00Z'},
                {'id': 'new', 'created_at': '2024-03-01T00:00:00Z'},
                {'id': 'mid', 'created_at': '2024-02-01T00:00:00Z'},
            ]
        }

        _, body = parse_response(
            handler_module.handler(make_event('GET', '/api/keyword-research/history'), {})
        )

        assert [item['id'] for item in body['items']] == ['new', 'mid', 'old']

    def test_does_not_pass_limit_to_scan(self, handler_module):
        """scan must not receive a Limit (it would truncate before filtering)."""
        mock_table.scan.return_value = {'Items': []}

        handler_module.handler(make_event('GET', '/api/keyword-research/history'), {})

        assert all('Limit' not in call.kwargs for call in mock_table.scan.call_args_list)

    def test_applies_limit_after_sorting(self, handler_module):
        """With limit=2, only the two most recent records are returned."""
        mock_table.scan.return_value = {
            'Items': [
                {'id': 'a', 'created_at': '2024-01-01T00:00:00Z'},
                {'id': 'b', 'created_at': '2024-02-01T00:00:00Z'},
                {'id': 'c', 'created_at': '2024-03-01T00:00:00Z'},
            ]
        }

        _, body = parse_response(
            handler_module.handler(
                make_event('GET', '/api/keyword-research/history', query_params={'limit': '2'}),
                {},
            )
        )

        assert [item['id'] for item in body['items']] == ['c', 'b']

    def test_pages_through_all_scan_results(self, handler_module):
        """Records spread across scan pages are all collected via LastEvaluatedKey."""
        mock_table.scan.side_effect = [
            {'Items': [{'id': 'page1', 'created_at': '2024-01-01T00:00:00Z'}], 'LastEvaluatedKey': {'id': 'page1'}},
            {'Items': [{'id': 'page2', 'created_at': '2024-02-01T00:00:00Z'}]},
        ]

        _, body = parse_response(
            handler_module.handler(make_event('GET', '/api/keyword-research/history'), {})
        )

        assert {item['id'] for item in body['items']} == {'page1', 'page2'}
        assert mock_table.scan.call_count == 2

    def test_filters_by_type_when_provided(self, handler_module):
        """A type filter is passed to scan as a FilterExpression on the type attr."""
        mock_table.scan.return_value = {'Items': []}

        handler_module.handler(
            make_event('GET', '/api/keyword-research/history', query_params={'type': 'competitor'}),
            {},
        )

        first_call = mock_table.scan.call_args_list[0]
        assert first_call.kwargs['ExpressionAttributeValues'] == {':type': 'competitor'}
