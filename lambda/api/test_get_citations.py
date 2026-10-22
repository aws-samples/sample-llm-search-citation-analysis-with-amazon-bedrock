"""Tests for the content types get-citations.py (``GET /api/citations``) reports per URL and in total.

Citations rows carry the ``content_type`` deduplication stored; rows written
before it existed get the type their URL implies. The table is a ``MagicMock``
stub answering one scan page.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from testing.citations_fixtures import VIDEO_URL, citation_row, citations_handler
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response

citations_module = citations_handler('get_citations_under_test')


def _citations(module, rows: list[dict[str, Any]], query: dict[str, str] | None = None) -> dict[str, Any]:
    table = fake_table(scan={'Items': rows})
    event = api_gateway_event('GET', '/api/citations', query={'include_keywords': 'true', **(query or {})})
    with patch.object(module, 'citations_table', table):
        status, body = parse_response(module.handler(event, None))
    assert status == 200
    return body


@pytest.fixture
def mixed_body(citations_module) -> dict[str, Any]:
    """Two keywords citing one stored video, a stored page and a legacy row of each type."""
    return _citations(citations_module, [
        citation_row(VIDEO_URL, 'hotels', 3, content_type='video'),
        citation_row(VIDEO_URL, 'family hotels', 2, content_type='video'),
        citation_row('https://a.example/guide', 'hotels', 2, content_type='page'),
        citation_row('https://youtu.be/aBcD_eF-123', 'hotels'),
        citation_row('https://b.example/list', 'hotels'),
    ])


def _types_by_url(body: dict[str, Any]) -> dict[str, str]:
    return {top_url['url']: top_url['content_type'] for top_url in body['top_urls']}


def test_reports_the_stored_content_type_of_each_url(mixed_body):
    assert _types_by_url(mixed_body)[VIDEO_URL] == 'video'


def test_reports_page_for_a_stored_page(mixed_body):
    assert _types_by_url(mixed_body)['https://a.example/guide'] == 'page'


def test_derives_video_from_the_url_of_a_row_stored_without_a_content_type(mixed_body):
    assert _types_by_url(mixed_body)['https://youtu.be/aBcD_eF-123'] == 'video'


def test_derives_page_from_the_url_of_a_row_stored_without_a_content_type(mixed_body):
    assert _types_by_url(mixed_body)['https://b.example/list'] == 'page'


def test_counts_distinct_urls_per_content_type(mixed_body):
    assert mixed_body['content_type_counts'] == {'video': 2, 'page': 2}


def test_keeps_aggregating_counts_and_keywords_across_rows_of_one_url(mixed_body):
    video = next(top_url for top_url in mixed_body['top_urls'] if top_url['url'] == VIDEO_URL)

    assert (video['citation_count'], video['keywords']) == (5, ['family hotels', 'hotels'])


def test_ignores_an_unknown_stored_content_type(citations_module):
    body = _citations(citations_module, [citation_row('https://a.example/x', 'hotels', content_type='podcast')])

    assert body['top_urls'][0]['content_type'] == 'page'


def test_reports_zero_for_every_content_type_when_there_are_no_citations(citations_module):
    assert _citations(citations_module, [])['content_type_counts'] == {'video': 0, 'page': 0}
