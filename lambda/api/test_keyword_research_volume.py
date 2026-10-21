"""Volume tests for GET /api/keyword-research/history.

Before: up to ``limit`` = 100 jobs in one response, each with its merged
result, rounds and config (``public_view``). Agent jobs with 300 proposed
keywords and their rationales run to about 100 KB of Spanish JSON each, so
100 of them came to about 10 MB, over the 6 MiB Lambda cap. Now each page is
cut to the 1 MB page budget and ``next_token`` continues it.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.utils import get_timestamp
from testing.events import api_gateway_event, parse_response
from testing.keyword_research_fixtures import load_keyword_research
from testing.response_size import assert_within_page_budget, long_text

_mod = load_keyword_research('keyword_research_volume_under_test')
_TYPES = ('expansion', 'competitor', 'agent')


def _job(index: int, job_type: str, *, keywords: int) -> dict[str, Any]:
    stamp = f'2026-09-{1 + index // 1440:02d}T{index // 60 % 24:02d}:{index % 60:02d}:00Z'
    return {
        'id': f'job-{index:04d}',
        'type': job_type,
        'status': 'completed',
        'created_at': stamp,
        'updated_at': get_timestamp(),
        'seed_keyword': f'hoteles en coruña {index}',
        'result': {
            'keywords': [
                {'keyword': f'hotel con encanto en galicia {n}', 'rationale': long_text(180)} for n in range(keywords)
            ],
        },
        'config': {'instruction': long_text(500)},
    }


def _type_table(rows: list[dict[str, Any]]) -> MagicMock:
    """A research table whose TypeCreatedIndex queries honour Limit and ExclusiveStartKey."""
    by_type: dict[str, list[dict[str, Any]]] = {}
    for row in sorted(rows, key=lambda item: item['created_at'], reverse=True):
        by_type.setdefault(row['type'], []).append(row)

    def query(**params: Any) -> dict[str, Any]:
        job_type = params['KeyConditionExpression'].get_expression()['values'][1]
        items = by_type.get(job_type, [])
        start = 0
        if 'ExclusiveStartKey' in params:
            start = [item['id'] for item in items].index(params['ExclusiveStartKey']['id']) + 1
        page = items[start:start + params['Limit']]
        response: dict[str, Any] = {'Items': [dict(item) for item in page]}
        if start + len(page) < len(items):
            last = page[-1]
            response['LastEvaluatedKey'] = {'id': last['id'], 'type': job_type, 'created_at': last['created_at']}
        return response

    table = MagicMock()
    table.query.side_effect = query
    return table


def _get(table: MagicMock, query: dict[str, str]) -> dict[str, Any]:
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
    collected: list[str] = []
    query = {'limit': str(limit)}
    for _page in range(200):
        _status, body = parse_response(_get(table, query))
        collected.extend(item['id'] for item in body['items'])
        if body['next_token'] is None:
            break
        query = {'limit': str(limit), 'next_token': body['next_token']}

    assert collected == [row['id'] for row in sorted(rows, key=lambda row: row['created_at'], reverse=True)]


def test_rejects_next_token_issued_for_another_type_filter() -> None:
    rows = [_job(index, 'expansion', keywords=1) for index in range(3)]
    _status, first = parse_response(_get(_type_table(rows), {'limit': '1'}))

    status, body = parse_response(_get(_type_table(rows), {'type': 'agent', 'next_token': first['next_token']}))

    assert (status, body) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})
