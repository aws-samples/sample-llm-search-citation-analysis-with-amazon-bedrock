"""Tests for the partition reads of get-crawled-content.py (``GET /api/crawled-content``).

A ``url`` reads that URL's partition of the CrawledContent table newest first:
the latest crawl only, or ``limit`` crawls with ``include_history``. A
``keyword`` reads its partition of the ``KeywordIndex`` GSI. The table is a
``MagicMock`` stub; the assertions pin the exact ``query`` arguments.
"""

from __future__ import annotations

import os
from unittest.mock import call, patch

import pytest
from boto3.dynamodb.conditions import Key

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_URL = 'https://example.com/hotels/coruna'
_CRAWL = {'normalized_url': _URL, 'crawled_at': '2026-05-02T08:00:00Z', 'keyword': 'hotel coruña'}

crawled_content_module = handler_fixture(
    _API_DIR,
    'get-crawled-content.py',
    'get_crawled_content_under_test',
    env={'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled-content'},
)


@pytest.mark.parametrize(('query', 'expected_query'), [
    pytest.param(
        {'url': _URL},
        call(KeyConditionExpression=Key('normalized_url').eq(_URL), ScanIndexForward=False, Limit=1),
        id='url-reads-only-the-latest-crawl',
    ),
    pytest.param(
        {'url': _URL, 'include_history': 'true', 'limit': '5'},
        call(KeyConditionExpression=Key('normalized_url').eq(_URL), ScanIndexForward=False, Limit=5),
        id='url-with-history-reads-limit-crawls',
    ),
    pytest.param(
        {'keyword': 'hotel coruña'},
        call(
            KeyConditionExpression=Key('keyword').eq('hotel coruña'), IndexName='KeywordIndex',
            ScanIndexForward=False, Limit=50,
        ),
        id='keyword-reads-its-keyword-index-partition',
    ),
])
def test_reads_the_newest_rows_of_the_requested_partition(crawled_content_module, query, expected_query):
    table = fake_table(query={'Items': [_CRAWL]})
    event = api_gateway_event('GET', '/api/crawled-content', query={**query, 'include_screenshot_url': 'false'})

    with patch.object(crawled_content_module, 'dynamodb', fake_dynamodb_resource(table)):
        status, body = parse_response(crawled_content_module.handler(event, None))

    assert table.query.call_args_list == [expected_query]
    assert (status, body) == (200, {'items': [_CRAWL], 'count': 1})
