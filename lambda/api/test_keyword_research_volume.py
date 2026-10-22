"""Volume tests for GET /api/keyword-research/history.

Before: up to ``limit`` = 100 jobs in one response, each with its merged
result, rounds and config (``public_view``). Agent jobs with 300 proposed
keywords and their rationales run to about 100 KB of Spanish JSON each, so
100 of them came to about 10 MB, over the 6 MiB Lambda cap. Now each page is
cut to the 1 MB page budget and ``next_token`` continues it.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.utils import get_timestamp
from testing.events import api_gateway_event, parse_response
from testing.keyword_research_fixtures import load_keyword_research
from testing.paging import INVALID_NEXT_TOKEN, follow_next_token, minute_stamp
from testing.partition_tables import PagedTable
from testing.response_size import assert_within_page_budget, long_text

_mod = load_keyword_research('keyword_research_volume_under_test')
_TYPES = ('expansion', 'competitor', 'agent')


def _job(index: int, job_type: str, *, keywords: int) -> dict[str, Any]:
    return {
        'id': f'job-{index:04d}',
        'type': job_type,
        'status': 'completed',
        'created_at': minute_stamp(index),
        'updated_at': get_timestamp(),
        'seed_keyword': f'hoteles en coruña {index}',
        'result': {
            'keywords': [
                {'keyword': f'hotel con encanto en galicia {n}', 'rationale': long_text(180)} for n in range(keywords)
            ],
        },
        'config': {'instruction': long_text(500)},
    }


def _type_table(rows: list[dict[str, Any]]) -> PagedTable:
    """The research table, paging its TypeCreatedIndex partitions like DynamoDB."""
    return PagedTable(rows, {None: ('id',), 'TypeCreatedIndex': ('type', 'created_at')})


def _get(table: PagedTable, query: dict[str, str]) -> dict[str, Any]:
    event = api_gateway_event('GET', '/api/keyword-research/history', query=query)
    with patch.object(_mod, 'research_table', table):
        return _mod.handler(event, None)


@pytest.fixture(scope='module')
def heavy_jobs() -> list[dict[str, Any]]:
    return [_job(index, _TYPES[index % 3], keywords=300) for index in range(300)]


def test_stays_within_page_budget_when_jobs_carry_large_results(heavy_jobs: list[dict[str, Any]]) -> None:
    response = _get(_type_table(heavy_jobs), {'limit': '100'})

    assert_within_page_budget(response)


def test_continues_with_next_token_when_page_budget_cuts_the_page(heavy_jobs: list[dict[str, Any]]) -> None:
    _status, body = parse_response(_get(_type_table(heavy_jobs), {'limit': '100'}))

    assert 0 < body['count'] < 100
    assert body['next_token'] is not None


@settings(max_examples=25, deadline=None)
@given(st.lists(st.sampled_from(_TYPES), max_size=30), st.integers(min_value=1, max_value=7))
def test_following_next_token_returns_every_job_once_newest_first(types: list[str], limit: int) -> None:
    rows = [_job(index, job_type, keywords=1) for index, job_type in enumerate(types)]
    table = _type_table(rows)

    collected = follow_next_token(
        lambda query: _get(table, query), {'limit': str(limit)}, lambda body: [item['id'] for item in body['items']],
    )

    assert collected == [row['id'] for row in sorted(rows, key=lambda row: row['created_at'], reverse=True)]


def test_rejects_next_token_issued_for_another_type_filter() -> None:
    rows = [_job(index, 'expansion', keywords=1) for index in range(3)]
    _status, first = parse_response(_get(_type_table(rows), {'limit': '1'}))

    assert parse_response(_get(_type_table(rows), {'type': 'agent', 'next_token': first['next_token']})) == INVALID_NEXT_TOKEN
