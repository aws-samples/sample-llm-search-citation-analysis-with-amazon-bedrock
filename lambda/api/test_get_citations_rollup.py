"""Tests for get-citations.py (``GET /api/citations``) answering from the citation rollup.

A build is published into an in-memory bucket; the handler must answer the
table, ``all``, market and group scopes from it (``source: rollup``, no
Citations read), fall back to the live read when the build is stale, missing
or unreadable, and keep one keyword live.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.citation_rollup import CURRENT_KEY
from shared.citation_rollup_serve import RollupReader
from testing.citation_rollup_fixtures import (
    ROLLUP_BUCKET,
    FakeS3,
    SegmentedTable,
    citation_rows,
    get_citations,
    published_rollup,
    rollup_bucket_fixture,
    rollup_keywords,
)
from testing.citations_fixtures import citations_handler

citations_module = citations_handler('get_citations_rollup_under_test')

_ROWS = citation_rows(keywords=12, urls_per_keyword=60, shared_urls=500)
_ACTIVE = [{**row, 'status': 'active'} for row in rollup_keywords(12, groups={index: {'coast'} for index in range(6)})]


@pytest.fixture(scope='module')
def published() -> dict[str, bytes]:
    return published_rollup(_ROWS, _ACTIVE)


s3 = rollup_bucket_fixture()


@pytest.fixture
def lambda_client() -> MagicMock:
    return MagicMock()


@pytest.fixture
def table() -> SegmentedTable:
    return SegmentedTable(_ROWS, max_page_rows=100)


def _get(module: Any, s3: FakeS3 | None, table: SegmentedTable, query: dict[str, str] | None, *, lambda_client: Any = None,
         active: list[dict[str, Any]] = _ACTIVE) -> dict[str, Any]:
    reader = None if s3 is None else RollupReader(s3, ROLLUP_BUCKET, lambda_client=lambda_client, function_name='summary')
    with patch.object(module, 'rollup_reader', reader):
        status, body = get_citations(module, table, query, active_keywords=active)
    assert status == 200
    return body


class TestServedFromTheRollup:
    def test_answers_the_table_scope_from_the_rollup_with_its_build_time(self, citations_module, s3, table):
        body = _get(citations_module, s3, table, {'limit': '25'})

        assert (body['source'], body['as_of'], body['stale']) == ('rollup', json.loads(s3.objects[CURRENT_KEY])['built_at'], False)

    def test_reads_no_citations_row_when_the_rollup_answers(self, citations_module, s3, table):
        _get(citations_module, s3, table, {'limit': '25'})

        assert table.scans == []

    @pytest.mark.parametrize('query', [
        {'limit': '25'},
        {'group_id': 'coast', 'limit': '50', 'offset': '20'},
        {'market_id': 'global', 'sort': 'domain', 'order': 'asc', 'include_keywords': 'true'},
        {'scope': 'all', 'content_type': 'video', 'min_citations': '2'},
    ], ids=['table', 'group-page', 'market-domain', 'all-video'])
    def test_lists_the_same_page_and_totals_as_the_live_read(self, citations_module, s3, table, query):
        rollup = _get(citations_module, s3, table, query)
        live = _get(citations_module, None, table, query)

        assert {**rollup, 'source': 'live', 'as_of': None} == live


class TestAnsweredLive:
    def test_answers_live_and_stale_when_the_groups_keywords_changed(self, citations_module, s3, table, lambda_client):
        changed = [{**row, 'group_ids': {'coast'}} if row['id'] == 'k9' else row for row in _ACTIVE]

        body = _get(citations_module, s3, table, {'group_id': 'coast'}, lambda_client=lambda_client, active=changed)

        assert (body['source'], body['stale'], body['total_citations']) == ('live', True, 7 * 60)

    def test_requests_a_rebuild_when_the_rollup_is_stale(self, citations_module, s3, table, lambda_client):
        changed = [row for row in _ACTIVE if row['id'] != 'k0']

        _get(citations_module, s3, table, {'scope': 'all'}, lambda_client=lambda_client, active=changed)

        assert json.loads(lambda_client.invoke.call_args.kwargs['Payload'])['reason'] == 'stale all'

    def test_answers_live_without_staleness_and_requests_a_build_before_the_first_one(self, citations_module, table, lambda_client):
        body = _get(citations_module, FakeS3(), table, None, lambda_client=lambda_client)

        assert (body['source'], body['stale'], lambda_client.invoke.call_count) == ('live', False, 1)

    def test_answers_live_when_a_rollup_object_cannot_be_read(self, citations_module, s3, table):
        s3.failing_keys = {key for key in s3.objects if key.endswith('manifest.json.gz')}

        body = _get(citations_module, s3, table, None)

        assert (body['source'], body['total_citations']) == ('live', len(_ROWS))

    def test_answers_one_keyword_live_without_reading_the_rollup(self, citations_module, s3, table):
        body = _get(citations_module, s3, table, {'keyword': 'keyword 003'})

        assert (body['source'], s3.reads) == ('live', [])
