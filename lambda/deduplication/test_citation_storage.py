"""
Tests for what deduplication stores and what it hands to the crawler.

Every deduplicated citation is stored in the Citations table, tagged with its
content type; only the top ``MAX_CRAWLS_PER_KEYWORD`` (environment variable
``MAX_CITATIONS_PER_KEYWORD``) travel on in the Step Functions state to be
crawled, because that state is capped at 256 KiB.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module_offline
from testing.provider_summary_fixtures import provider_row

_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))


def _load(env: dict[str, str]):
    with patch.dict(os.environ, {'DYNAMODB_TABLE_CITATIONS': 'test-citations', **env}):
        return load_handler_module_offline(_HANDLER_DIR, 'handler.py', 'deduplication_storage_under_test')


@pytest.fixture
def dedup():
    """The dedup module with a crawl cap of two and a recording citations table."""
    module = _load({'MAX_CITATIONS_PER_KEYWORD': '2'})
    module.__dict__['citations_table'] = MagicMock()
    return module


@pytest.fixture
def five_citation_event() -> dict[str, Any]:
    """OpenAI and Gemini cite five distinct URLs; `a.example` twice and the video three ways."""
    return {
        'keyword': 'family hotels',
        'timestamp': '2026-10-08T10:00:00Z',
        'results': [
            provider_row('openai', ['https://a.example', 'https://youtu.be/dQw4w9WgXcQ?t=42', 'https://c.example']),
            provider_row('gemini', [
                'https://a.example',
                'https://m.youtube.com/watch?v=dQw4w9WgXcQ&si=x',
                'https://d.example',
                'https://e.example',
            ]),
            provider_row('claude', ['https://www.youtube.com/shorts/dQw4w9WgXcQ']),
        ],
    }


def _stored_urls(dedup) -> list[str]:
    return [call.kwargs['Key']['normalized_url'] for call in dedup.citations_table.update_item.call_args_list]


def _stored_values(dedup, url: str) -> dict[str, Any]:
    for call in dedup.citations_table.update_item.call_args_list:
        if call.kwargs['Key']['normalized_url'] == url:
            return call.kwargs['ExpressionAttributeValues']
    raise AssertionError(f'{url} was not stored')


def test_stores_every_deduplicated_citation_beyond_the_crawl_cap(dedup, five_citation_event):
    dedup.handler(five_citation_event, None)

    assert _stored_urls(dedup) == [
        _VIDEO,
        'https://a.example',
        'https://c.example',
        'https://d.example',
        'https://e.example',
    ]


def test_hands_only_the_top_ranked_citations_to_the_crawler(dedup, five_citation_event):
    result = dedup.handler(five_citation_event, None)

    assert [citation['normalized_url'] for citation in result['deduplicated_citations']] == [
        _VIDEO,
        'https://a.example',
    ]


def test_counts_every_stored_citation_in_the_total_not_only_the_crawled_ones(dedup, five_citation_event):
    assert dedup.handler(five_citation_event, None)['total_citations_found'] == 8


def test_merges_every_link_shape_of_one_video_into_one_citation(dedup, five_citation_event):
    result = dedup.handler(five_citation_event, None)

    video = result['deduplicated_citations'][0]
    assert (video['citation_count'], video['citing_providers']) == (3, ['claude', 'gemini', 'openai'])
    assert video['original_urls'] == [
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ&si=x',
        'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ?t=42',
    ]


def test_stores_video_content_type_on_a_youtube_citation_row(dedup, five_citation_event):
    dedup.handler(five_citation_event, None)

    assert _stored_values(dedup, _VIDEO)[':content_type'] == 'video'


def test_stores_page_content_type_on_an_ordinary_citation_row(dedup, five_citation_event):
    dedup.handler(five_citation_event, None)

    assert _stored_values(dedup, 'https://e.example')[':content_type'] == 'page'


def test_writes_content_type_in_the_citation_update_expression(dedup, five_citation_event):
    dedup.handler(five_citation_event, None)

    expression = dedup.citations_table.update_item.call_args.kwargs['UpdateExpression']
    assert 'content_type = :content_type' in expression


def test_tags_each_crawl_item_with_its_content_type(dedup, five_citation_event):
    result = dedup.handler(five_citation_event, None)

    assert [citation['content_type'] for citation in result['deduplicated_citations']] == ['video', 'page']


def test_numbers_every_stored_citation_by_rank(dedup, five_citation_event):
    dedup.handler(five_citation_event, None)

    priorities = [call.kwargs['ExpressionAttributeValues'][':priority']
                  for call in dedup.citations_table.update_item.call_args_list]
    assert priorities == [1, 2, 3, 4, 5]


def test_uses_the_shared_default_crawl_cap_when_no_override_is_set():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop('MAX_CITATIONS_PER_KEYWORD', None)
        module = _load({})

    assert module.MAX_CRAWLS_PER_KEYWORD == 20
