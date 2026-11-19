"""``/api/reextract`` (``manage-reextract.py``): estimate, start, read and stop a brand re-extract."""

from __future__ import annotations

import os
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from shared.brand_names import BRANDS_VERSION
from testing.admin_authz_fixtures import caller_event, invoke
from testing.client_errors import throttled
from testing.handler_fixtures import handler_fixture
from testing.memory_dynamodb import MemoryTable
from testing.reextract_fakes import JobTable, RecordingInvoker, answer_row, answers_table, keyword_item
from testing.scope_snapshot_fixtures import keywords_table

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'CORS_ORIGIN_PARAM': '',
    'REEXTRACT_WORKER_FUNCTION_NAME': 'test-reextract-worker',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-groups',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_REEXTRACT_JOBS': 'test-jobs',
}
_MODEL = 'global.anthropic.claude-haiku-5-5'

reextract_api = handler_fixture(_API_DIR, 'manage-reextract.py', 'manage_reextract_under_test', env=_ENV)


@pytest.fixture
def aws(reextract_api) -> Iterator[SimpleNamespace]:
    groups = MemoryTable('test-groups', ('id',))
    groups.put_item(Item={'id': 'g1', 'name': 'Lima'})
    tables = {
        'test-groups': groups,
        'test-keywords': keywords_table([keyword_item('hotels', group_ids=['g1']), keyword_item('motels')]),
        'test-search-results': answers_table([
            answer_row('hotels'), answer_row('hotels', 'gemini'), answer_row('hotels', 'claude', brands_version=BRANDS_VERSION),
            answer_row('motels'),
        ]),
        'test-jobs': JobTable(),
    }
    invoker = RecordingInvoker()
    resource = SimpleNamespace(Table=tables.__getitem__)
    with (
        patch.dict(os.environ, _ENV),
        patch.object(reextract_api, 'dynamodb', resource),
        patch.object(reextract_api, 'lambda_client', invoker),
        patch.object(reextract_api, 'get_model_id', return_value=_MODEL),
    ):
        yield SimpleNamespace(tables=tables, invoker=invoker)


@pytest.fixture
def started(reextract_api, aws) -> str:
    """The id of a job just started over every keyword."""
    return _call(reextract_api, 'POST', '/api/reextract', body={})[1]['job']['job_id']


def _call(module: Any, method: str, path: str, *, groups: str | None = 'Admin', **request: Any) -> tuple[int, Any]:
    return invoke(module, caller_event(method, path, groups=groups, resource=path, **request))


class TestEstimate:
    def test_counts_the_outdated_answers_of_the_group_and_prices_them(self, reextract_api, aws):
        status, body = _call(reextract_api, 'POST', '/api/reextract/estimate', body={'group_ids': ['g1']})
        assert (status, body['answers'], body['answers_current'], body['keywords']) == (200, 2, 1, 1)

    def test_names_the_model_rule_and_cost(self, reextract_api, aws):
        _, body = _call(reextract_api, 'POST', '/api/reextract/estimate', body={})
        assert (body['model'], body['brands_version'], body['estimated_cost_usd'], body['truncated']) == (_MODEL, BRANDS_VERSION, 0.0033, False)

    def test_refuses_an_unknown_group(self, reextract_api, aws):
        status, body = _call(reextract_api, 'POST', '/api/reextract/estimate', body={'group_ids': ['nope']})
        assert (status, body['field']) == (400, 'group_ids')

    def test_refuses_a_bad_date(self, reextract_api, aws):
        status, body = _call(reextract_api, 'POST', '/api/reextract/estimate', body={'since': '01/10/2026'})
        assert (status, body['field']) == (400, 'since')

    def test_refuses_a_caller_who_is_not_an_admin(self, reextract_api, aws):
        assert _call(reextract_api, 'POST', '/api/reextract/estimate', groups='Users', body={})[0] == 403


class TestStart:
    def test_starts_a_job_and_its_worker_at_step_zero(self, reextract_api, aws):
        status, body = _call(reextract_api, 'POST', '/api/reextract', body={'group_ids': ['g1']})
        assert (status, body['job']['status'], body['job']['answers_total']) == (202, 'running', 2)
        assert aws.invoker.calls == [('test-reextract-worker', {'job_id': body['job']['job_id'], 'step': 0})]

    def test_records_who_started_it_and_the_filters(self, reextract_api, aws):
        _, body = _call(reextract_api, 'POST', '/api/reextract', body={'since': '2026-10-01'})
        assert (body['job']['created_by'], body['job']['filters']['since']) == ('admin@example.com', '2026-10-01')

    def test_names_the_extraction_model_it_was_priced_for(self, reextract_api, aws):
        _, body = _call(reextract_api, 'POST', '/api/reextract', body={})
        assert body['job']['model'] == _MODEL

    def test_refuses_a_second_job_while_one_runs(self, reextract_api, started):
        status, body = _call(reextract_api, 'POST', '/api/reextract', body={})
        assert (status, body['error'], body['job']['job_id']) == (409, 'A re-extract is already running', started)

    def test_refuses_filters_that_cover_no_answer(self, reextract_api, aws):
        status, body = _call(reextract_api, 'POST', '/api/reextract', body={'since': '2027-01-01'})
        assert (status, body['field']) == (400, 'filters')

    def test_a_worker_that_cannot_start_fails_the_job_and_frees_the_next_start(self, reextract_api, aws):
        aws.invoker.error = throttled('Invoke')
        assert _call(reextract_api, 'POST', '/api/reextract', body={})[0] == 503
        aws.invoker.error = None
        assert _call(reextract_api, 'POST', '/api/reextract', body={})[0] == 202


class TestReadAndStop:
    def test_no_job_yet_reads_as_none_and_inactive(self, reextract_api, aws):
        assert _call(reextract_api, 'GET', '/api/reextract') == (200, {'job': None, 'active': False})

    def test_reads_the_newest_job_as_active(self, reextract_api, started):
        _, body = _call(reextract_api, 'GET', '/api/reextract')
        assert (body['job']['job_id'], body['active']) == (started, True)

    def test_reads_one_job_by_id(self, reextract_api, started):
        assert _call(reextract_api, 'GET', f'/api/reextract/{started}', path_params={'id': started})[1]['job']['job_id'] == started

    def test_an_unknown_job_is_not_found(self, reextract_api, aws):
        assert _call(reextract_api, 'GET', '/api/reextract/rx-missing', path_params={'id': 'rx-missing'})[0] == 404

    def test_stop_moves_the_job_to_stopping(self, reextract_api, started):
        status, body = _call(reextract_api, 'POST', f'/api/reextract/{started}/stop', path_params={'id': started})
        assert (status, body['job']['status']) == (200, 'stopping')

    def test_stop_of_an_unknown_job_is_not_found(self, reextract_api, aws):
        assert _call(reextract_api, 'POST', '/api/reextract/rx-missing/stop', path_params={'id': 'rx-missing'})[0] == 404

    def test_reading_needs_an_admin_too(self, reextract_api, aws):
        assert _call(reextract_api, 'GET', '/api/reextract', groups='Users')[0] == 403
