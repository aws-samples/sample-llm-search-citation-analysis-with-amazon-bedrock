"""Mention view jobs: a job's result equals the live answer over the same run (design 2.45.0 §2.4, §5 tests 2, 4 and 5)."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from shared import mention_view_jobs
from shared.api_response import success_response
from shared.mention_view_jobs import (
    ROUTE_APPEARANCES,
    ROUTE_SENTIMENT,
    ROUTE_SUMMARY,
    compute_mention_view,
    job_build_id,
    job_scope_contract,
    mention_job_answer,
)
from shared.scope_params import ReportScope
from shared.snapshot_artifacts import (
    KeywordCursor,
    computing_response,
    cursor_expired_body,
    encode_keyword_cursor,
    failed_job_body,
)
from testing.mention_snapshot_fixtures import MentionTenant, status_and_code, tenant_fixture
from testing.scale_data import ScaleSpec

_BUILT_AT = '2026-10-05T07:40:00Z'


tenant = tenant_fixture(ScaleSpec(keywords=9, personas=2, runs=2, long_tail=15))


def _job(tenant: MentionTenant, route: str, **params: Any) -> dict[str, Any]:
    return compute_mention_view(route, params, tenant.keywords, tenant.job_readers(), built_at=_BUILT_AT)


def _pages(tenant: MentionTenant, route: str, items: str, **params: Any) -> list[Any]:
    collected: list[Any] = []
    token: str | None = None
    for _page in range(1_000):
        body = _job(tenant, route, **params, next_token=token)
        collected.extend(body[items])
        token = body['next_token']
        if token is None:
            return collected
    raise AssertionError('next_token never ran out')


class TestResults:
    def test_summary_of_an_older_run_equals_the_live_summary_of_that_run(self, tenant):
        body = _job(tenant, ROUTE_SUMMARY, timestamp=tenant.previous_timestamp, query_prompt_id=None, provider=None, classification=None)

        assert body['aggregated'] == tenant.oracle_summary(None, None, None, previous=True)

    def test_summary_names_the_run_asked_for_and_the_job_time(self, tenant):
        body = _job(tenant, ROUTE_SUMMARY, timestamp=tenant.previous_timestamp)

        assert (body['timestamp'], body['as_of'], body['keywords_analyzed']) == (tenant.previous_timestamp, _BUILT_AT, tenant.spec.keywords)

    def test_appearance_pages_of_an_older_run_equal_the_live_list(self, tenant):
        pages = _pages(tenant, ROUTE_APPEARANCES, 'appearances', timestamp=tenant.previous_timestamp, limit=40, brand=None, classification=None)

        assert pages == tenant.oracle_appearances(None, None, None, None, previous=True)

    def test_sentiment_pages_equal_the_live_examples(self, tenant):
        pages = _pages(tenant, ROUTE_SENTIMENT, 'examples', sentiment='positive', provider=None, classification='first_party', limit=9)

        assert pages == tenant.oracle_examples('positive', None, 'first_party')[1]

    def test_answers_cursor_expired_for_a_cursor_of_another_build(self, tenant):
        token = encode_keyword_cursor(KeywordCursor(1, 0, 'another-build'), 9)

        assert _job(tenant, ROUTE_APPEARANCES, next_token=token, limit=10) == cursor_expired_body()

    def test_build_id_changes_with_the_run(self, tenant):
        assert job_build_id(tenant.keywords, tenant.latest_timestamp) != job_build_id(tenant.keywords, tenant.previous_timestamp)

    def test_refuses_a_route_it_does_not_compute(self, tenant):
        with pytest.raises(ValueError, match='not a mention view route'):
            _job(tenant, 'visibility')


_SCOPE = ReportScope(kind='group', keywords=('hotel a', 'hotel b'), scope={'mode': 'group', 'group_id': 'coruna'}, label='Coruña')


def _answer(stored: dict[str, Any], params: dict[str, Any] | None = None) -> dict[str, Any]:
    with patch.object(mention_view_jobs, 'view_job_response', return_value=stored) as started:
        response = mention_job_answer(ROUTE_SUMMARY, params or {}, _SCOPE, {}, job_scope_contract(_SCOPE, {'config': {}}))
    response['started'] = started.call_count
    return response


class TestAnswer:
    def test_passes_a_computing_202_through(self):
        computing = computing_response('job-1', '2026-10-05T07:40:00Z', {})

        assert _answer(computing)['statusCode'] == 202

    def test_passes_a_failed_job_through(self):
        response = _answer(success_response(failed_job_body('boom'), {}))

        assert json.loads(response['body']) == {'status': 'failed', 'message': 'boom'}

    def test_turns_a_stored_cursor_expired_into_the_400(self):
        assert status_and_code(_answer(success_response(cursor_expired_body(), {}))) == (400, 'cursor_expired')

    def test_refuses_a_malformed_token_before_starting_a_job(self):
        response = _answer(success_response({}, {}), {'next_token': 'not-a-token'})

        assert (response['statusCode'], response['started']) == (400, 0)

    def test_wraps_a_result_in_the_scope_contract_with_its_coverage(self):
        result = {'aggregated': {}, 'keywords_analyzed': 1, 'as_of': _BUILT_AT}
        body = json.loads(_answer(success_response(result, {}))['body'])

        assert (body['coverage'], body['source'], body['as_of'], body['config']) == (
            {'keywords_total': 2, 'keywords_analyzed': 1, 'complete': False}, 'snapshot', _BUILT_AT, {},
        )
