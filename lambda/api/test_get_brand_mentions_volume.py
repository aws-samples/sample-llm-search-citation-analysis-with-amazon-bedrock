"""Volume tests for GET /api/brand-mentions: every answer stays within one page budget.

Data: 200 keywords of one group, one run each, 9 providers x 2 personas, ten
brands per answer with the extraction's Spanish prose
(``testing.brand_mentions_fixtures``). Before the summary / appearances split
the group answer carried every appearance twice (``brands`` plus
``first_party_brands`` / ``competitor_brands``): measured with the old handler
at 49 MB for this data set (a 60-keyword group: 15 MB); now about 0.6 MB
whatever the group size. A single keyword with ten 60,000-character Spanish
answers was 1.2 MB (grows with answer length); now 0.36 MB.
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from testing.brand_mentions_fixtures import VOLUME_GROUP_ID, volume_keyword_text, volume_keywords, volume_rows
from testing.report_scope_fixtures import load_scoped_handler, scoped_report
from testing.response_size import assert_within_page_budget

_HERE = os.path.dirname(os.path.abspath(__file__))
_GROUP_KEYWORDS = 200
_PAGE_KEYWORDS = 3


@pytest.fixture(scope='module')
def brand_mentions():
    return load_scoped_handler(_HERE, 'get-brand-mentions.py', '_volume')


@pytest.fixture(scope='module')
def group_rows():
    return volume_rows(_GROUP_KEYWORDS)


def _report(module: Any, rows: dict[str, list[dict[str, Any]]], keyword_count: int):
    return scoped_report(module, {'tracked_brands': {}}, search_rows=rows, active=volume_keywords(keyword_count))


def _all_pages(report: Any, params: dict[str, str]) -> list[list[dict[str, Any]]]:
    pages: list[list[dict[str, Any]]] = []
    token: str | None = None
    while True:
        body = report.body({**params, **({'next_token': token} if token else {})})
        pages.append(body['appearances'])
        token = body['next_token']
        if token is None:
            return pages


def test_stays_within_page_budget_when_a_large_group_is_summarized(brand_mentions, group_rows):
    with _report(brand_mentions, group_rows, _GROUP_KEYWORDS) as report:
        response = report.call({'group_id': VOLUME_GROUP_ID})

    assert_within_page_budget(response)


def test_summary_reports_every_brand_when_the_brand_list_is_capped(brand_mentions, group_rows):
    with _report(brand_mentions, group_rows, _GROUP_KEYWORDS) as report:
        aggregated = report.body({'group_id': VOLUME_GROUP_ID})['aggregated']

    # 3 tracked brands + 7 brands of their own per keyword.
    assert (aggregated['total_unique_brands'], len(aggregated['brands']), aggregated['brands_truncated']) == (
        3 + 7 * _GROUP_KEYWORDS, 100, True,
    )


def test_summary_counts_every_appearance_of_a_capped_preview(brand_mentions, group_rows):
    with _report(brand_mentions, group_rows, _GROUP_KEYWORDS) as report:
        brand = report.body({'group_id': VOLUME_GROUP_ID})['aggregated']['brands'][0]

    assert (brand['name'], brand['appearance_count'], len(brand['appearances'])) == (
        'Hotel Coruña', _GROUP_KEYWORDS * 9 * 2, 5,
    )


def test_stays_within_page_budget_when_a_large_group_is_paged_by_appearance(brand_mentions, group_rows):
    with _report(brand_mentions, group_rows, _GROUP_KEYWORDS) as report:
        response = report.call({'group_id': VOLUME_GROUP_ID, 'view': 'appearances', 'limit': '2000'})

    assert_within_page_budget(response)


def test_stays_within_page_budget_when_one_keyword_has_long_answers(brand_mentions):
    rows = volume_rows(1, response_chars=60_000, providers=('openai', 'perplexity', 'gemini', 'claude', 'bedrock'))
    with _report(brand_mentions, rows, 1) as report:
        response = report.call({'keyword': volume_keyword_text(0)})

    assert_within_page_budget(response)


def test_single_keyword_answer_marks_cut_answer_text(brand_mentions):
    rows = volume_rows(1, response_chars=60_000, providers=('openai',))
    with _report(brand_mentions, rows, 1) as report:
        entry = report.body({'keyword': volume_keyword_text(0)})['by_provider'][0]

    assert (len(entry['full_response']), entry['response_truncated'], entry['response_length']) == (12_000, True, 60_000)


def test_following_next_token_returns_every_appearance_once_in_order_for_a_large_group(brand_mentions, group_rows):
    params = {'group_id': VOLUME_GROUP_ID, 'view': 'appearances', 'limit': '2000'}
    with _report(brand_mentions, group_rows, _GROUP_KEYWORDS) as report:
        pages = _all_pages(report, params)
        total = report.body(params)['total_appearances']

    rows = [row for page in pages for row in page]
    assert len(rows) == total == _GROUP_KEYWORDS * 9 * 2 * 10
    assert len({json.dumps(row, sort_keys=True, default=str) for row in rows}) == total


@settings(max_examples=15, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(limit=st.integers(min_value=1, max_value=400))
def test_following_next_token_returns_every_appearance_once_in_order(brand_mentions, limit):
    rows = volume_rows(_PAGE_KEYWORDS, providers=('openai', 'gemini'))
    with _report(brand_mentions, rows, _PAGE_KEYWORDS) as report:
        expected = report.body({'group_id': VOLUME_GROUP_ID, 'view': 'appearances', 'limit': '2000'})['appearances']
        pages = _all_pages(report, {'group_id': VOLUME_GROUP_ID, 'view': 'appearances', 'limit': str(limit)})

    assert [row for page in pages for row in page] == expected


@pytest.mark.parametrize('token', ['not-a-token', 'eyJvZmZzZXQiOi0xfQ', 'eyJpZCI6ImEifQ'])
def test_rejects_a_malformed_next_token_with_400(brand_mentions, token):
    with _report(brand_mentions, volume_rows(1, providers=('openai',)), 1) as report:
        response = report.call({'group_id': VOLUME_GROUP_ID, 'view': 'appearances', 'next_token': token})

    assert (response['statusCode'], json.loads(response['body'])['field']) == (400, 'next_token')
