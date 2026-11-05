"""Tests for the time budget of get-citations.py (``GET /api/citations``): a slow read answers partial data, never a 504.

The customer's unscoped request read 25 one-MB pages in 24.4 s and hit API
Gateway's 29 s. Every read now stops early enough to answer, and the answer
says it is partial with ``truncated: true``. ``SegmentedTable`` pages like
DynamoDB; the Lambda context says how much time is left.
"""

from __future__ import annotations

from typing import Any

import pytest

from testing.citation_rollup_fixtures import SegmentedTable, citation_rows, get_citations, lambda_context
from testing.citations_fixtures import citations_handler

citations_module = citations_handler('get_citations_deadline_under_test')

_ROWS = citation_rows(keywords=10, urls_per_keyword=40)
_ACTIVE = [{'id': f'k{index}', 'keyword': f'keyword {index:03d}', 'status': 'active', 'group_ids': {'g1'}} for index in range(10)]


def _get(module: Any, query: dict[str, str] | None, remaining_ms: int) -> tuple[int, Any]:
    table = SegmentedTable(_ROWS, max_page_rows=30)
    return get_citations(module, table, query, active_keywords=_ACTIVE, context=lambda_context(remaining_ms))


@pytest.fixture
def nearly_expired_table_read(citations_module) -> tuple[int, Any]:
    """The unscoped read of a Lambda with one second left: less than the aggregation reserve."""
    return _get(citations_module, None, remaining_ms=1_000)


def test_answers_200_when_the_deadline_expires_mid_table_scan(nearly_expired_table_read):
    assert nearly_expired_table_read[0] == 200


def test_reports_truncated_when_the_deadline_expires_mid_table_scan(nearly_expired_table_read):
    _, body = nearly_expired_table_read

    assert (body['truncated'], body['total_citations']) == (True, 30)


def test_reports_truncated_when_the_deadline_expires_before_a_group_read(citations_module):
    status, body = _get(citations_module, {'group_id': 'g1'}, remaining_ms=1_000)

    assert (status, body['truncated'], body['total_citations']) == (200, True, 0)


@pytest.mark.parametrize('query', [None, {'group_id': 'g1'}], ids=['table', 'group'])
def test_reads_every_row_untruncated_with_time_to_spare(citations_module, query):
    _, body = _get(citations_module, query, remaining_ms=29_000)

    assert (body['truncated'], body['total_citations']) == (False, len(_ROWS))
