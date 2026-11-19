"""The re-extract worker (``reextract_worker``): rewrites stored answers' brands, keeps the old ones, stops and resumes."""

from __future__ import annotations

import copy
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from unittest.mock import patch

import pytest
import reextract_worker
from botocore.exceptions import ClientError

from brand_extractor import BrandExtractionError
from shared.brand_names import BRANDS_VERSION
from shared.change_events import REEXTRACT_CHANGED
from shared.markets import markets_item
from shared.reextract import ScopedKeyword
from shared.reextract_jobs import new_job_item
from shared.request_deadline import Deadline
from testing.deadlines import spent_deadline
from testing.memory_dynamodb import MemoryTable
from testing.provider_response_fixtures import build_market
from testing.reextract_fakes import FakeJobs, RecordingInvoker, answer_row, answers_table, conditional_failure

_MARKET = build_market(competitors=['Brisa Resorts'], first_party_aliases=[])
_NEW_BRANDS = [{'name': 'Costamar Brisa', 'parent_company': 'Costamar', 'classification': 'competitor'}]
_HOTELS = ScopedKeyword('hotels', 'global')
_MOTELS = ScopedKeyword('motels', 'global')
_REBUILD_FUNCTION = 'test-dedup'


def _fake_extract(text: str, config: dict[str, Any] | None = None, *, strict: bool = False) -> dict[str, Any]:
    assert strict is True
    if 'FAIL' in text:
        raise BrandExtractionError('Bedrock answered nothing')
    return {'brands': copy.deepcopy(_NEW_BRANDS), 'brand_count': 1, 'config': config}


@pytest.fixture
def extract() -> Iterator[Any]:
    with (
        patch.object(reextract_worker, 'extract_brands_from_response', side_effect=_fake_extract) as fake,
        patch.object(reextract_worker, 'get_model_id', return_value='global.anthropic.claude-haiku-5-5'),
    ):
        yield fake


@pytest.fixture
def invoker() -> Iterator[RecordingInvoker]:
    recorder = RecordingInvoker()
    with patch.object(reextract_worker, 'lambda_client', recorder), patch.dict(os.environ, {'KPI_REBUILD_FUNCTION_NAME': _REBUILD_FUNCTION}):
        yield recorder


@pytest.fixture
def pool() -> Iterator[ThreadPoolExecutor]:
    with ThreadPoolExecutor(max_workers=2) as executor:
        yield executor


def _brand_config_table() -> MemoryTable:
    table = MemoryTable('test-brand-config', ('config_id',))
    table.put_item(Item={'config_id': 'default', 'industry': 'hotels', 'tracked_brands': {'first_party': ['Example Hotels'], 'competitors': ['Costamar']}})
    table.put_item(Item=markets_item([_MARKET], '2026-10-01T00:00:00Z'))
    return table


def _job(**overrides: Any) -> dict[str, Any]:
    job = new_job_item({}, 'admin@example.com', answers=2, keywords=1, cost=0.002, brands_version=BRANDS_VERSION)
    job.update(overrides)
    return job


def _work(rows: list[dict[str, Any]], pool: ThreadPoolExecutor, *, job: dict[str, Any] | None = None, deadline: Deadline | None = None,
          jobs: FakeJobs | None = None) -> reextract_worker.ReextractPass:
    job = job or _job()
    store = jobs or FakeJobs(copy.deepcopy(job))
    return reextract_worker.ReextractPass(
        store, copy.deepcopy(store.job), int(job.get('step') or 0), deadline or Deadline(3600), answers_table(rows),
        reextract_worker.BrandConfigs(_brand_config_table()), pool,
    )


def _stopping_work(pool: ThreadPoolExecutor) -> reextract_worker.ReextractPass:
    """A pass over one batch and one answer more, whose job is asked to stop at its first save."""
    answers = reextract_worker.BATCH_SIZE + 1
    job = _job(answers_total=answers, answers_cap=answers)
    return _work(_many(answers), pool, job=job, jobs=FakeJobs(copy.deepcopy(job), stop_after_saves=1))


def _released(work: reextract_worker.ReextractPass) -> list[str]:
    assert isinstance(work.jobs, FakeJobs)
    return work.jobs.released


def _row(work: reextract_worker.ReextractPass, keyword: str, provider: str = 'openai') -> dict[str, Any]:
    return next(row for row in work.search_table.rows.values() if row['keyword'] == keyword and row['provider'] == provider)


@pytest.fixture
def rewritten(extract, invoker, pool) -> reextract_worker.ReextractPass:
    """A pass that ran over one outdated answer of ``hotels``."""
    work = _work([answer_row('hotels')], pool)
    work.run([_HOTELS])
    return work


class TestRewrite:
    def test_rewrites_an_outdated_answer_with_the_new_brands_and_rule(self, rewritten):
        row = _row(rewritten, 'hotels')
        assert (row['brands'], row['brand_count'], row['brands_version']) == (_NEW_BRANDS, 1, BRANDS_VERSION)

    def test_keeps_the_previous_brands_in_the_history(self, rewritten):
        (previous,) = _row(rewritten, 'hotels')['brands_history']
        assert (previous['brands'], previous['brands_version'], previous['job_id']) == ([{'name': 'Costamar'}], 0, rewritten.job_id)

    def test_names_the_job_the_admin_and_the_model_on_the_row(self, rewritten):
        row = _row(rewritten, 'hotels')
        assert (row['brands_job_id'], row['brands_extracted_by'], row['brands_model']) == (
            rewritten.job_id, 'admin@example.com', 'global.anthropic.claude-haiku-5-5',
        )

    def test_a_second_rewrite_keeps_how_the_first_was_made_in_the_history(self, extract, invoker, pool):
        first = {'brands_version': 2, 'brands_model': 'global.anthropic.claude-sonnet-5-5', 'brands_extracted_by': 'other@example.com'}
        work = _work([answer_row('hotels', **first)], pool, job=_job(filters={'only_outdated': False}))
        work.run([_HOTELS])
        (previous,) = _row(work, 'hotels')['brands_history']
        assert (previous['brands_model'], previous['brands_extracted_by'], previous['replaced_by']) == (
            'global.anthropic.claude-sonnet-5-5', 'other@example.com', 'admin@example.com',
        )

    def test_the_job_names_the_model_that_ran(self, rewritten):
        assert rewritten.job['model'] == 'global.anthropic.claude-haiku-5-5'

    def test_extracts_with_the_brand_config_of_the_answers_market(self, extract, invoker, pool):
        work = _work([answer_row('hoteles', market_id=_MARKET.market_id)], pool)
        work.run([ScopedKeyword('hoteles', _MARKET.market_id)])
        competitors = extract.call_args.kwargs['config']['tracked_brands']['competitors']
        assert competitors == ['Costamar', 'Brisa Resorts']

    def test_a_failed_extraction_keeps_the_row_and_counts_as_failed(self, extract, invoker, pool):
        work = _work([answer_row('hotels', response='FAIL'), answer_row('hotels', 'gemini')], pool)
        work.run([_HOTELS])
        assert (_row(work, 'hotels')['brands'], work.tallies.answers_failed, work.tallies.answers_done) == ([{'name': 'Costamar'}], 1, 1)

    def test_a_row_another_writer_made_current_counts_as_skipped(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool)
        work.search_table.update_error = conditional_failure()
        work.run([_HOTELS])
        assert (work.tallies.answers_skipped, work.tallies.answers_done) == (1, 0)

    def test_answers_already_current_are_left_alone(self, extract, invoker, pool):
        work = _work([answer_row('hotels', brands_version=BRANDS_VERSION)], pool)
        work.run([_HOTELS])
        assert work.search_table.updates == []

    def test_every_keyword_done_is_counted(self, extract, invoker, pool):
        work = _work([answer_row('hotels'), answer_row('motels')], pool)
        assert (work.run([_HOTELS, _MOTELS]), work.tallies.keywords_done) == ('done', 2)

    def test_each_saved_batch_is_announced_with_the_job_and_status(self, rewritten, change_events_bus):
        assert change_events_bus.details(REEXTRACT_CHANGED)[0] == {'job_id': rewritten.job_id, 'status': 'running'}


def _many(count: int) -> list[dict[str, Any]]:
    return [answer_row('hotels', f'engine-{index:02d}') for index in range(count)]


class TestStopAndResume:
    def test_a_job_asked_to_stop_stops_after_the_batch(self, extract, invoker, pool):
        work = _stopping_work(pool)
        assert (work.run([_HOTELS]), work.tallies.answers_done) == ('stopping', reextract_worker.BATCH_SIZE)

    def test_a_pass_without_time_for_a_batch_does_nothing(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool, deadline=spent_deadline())
        assert (work.run([_HOTELS]), work.search_table.updates) == ('out_of_time', [])

    def test_a_pass_resumes_after_the_saved_answer(self, extract, invoker, pool):
        rows = [answer_row('hotels', 'claude'), answer_row('hotels', 'openai')]
        work = _work(rows, pool, job=_job(cursor_keyword='hotels', cursor_key=rows[0]['timestamp_provider']))
        work.run([_HOTELS])
        assert work.search_table.updates == [{'keyword': 'hotels', 'timestamp_provider': rows[1]['timestamp_provider']}]

    def test_a_pass_skips_the_keywords_done_before_the_cursor(self, extract, invoker, pool):
        work = _work([answer_row('hotels'), answer_row('motels')], pool, job=_job(cursor_keyword='hotels', cursor_key=None))
        work.run([_HOTELS, _MOTELS])
        assert [update['keyword'] for update in work.search_table.updates] == ['motels']

    def test_a_job_already_stopping_stops_at_once(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool, job=_job(status='stopping'))
        assert (work.run([_HOTELS]), work.search_table.updates) == ('stopping', [])


class TestEnd:
    def test_out_of_time_hands_the_job_to_the_next_step(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool, deadline=spent_deadline())
        assert reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn') == 'continued'
        assert invoker.calls == [('worker-fn', {'job_id': work.job_id, 'step': 1})]

    def test_a_finished_job_is_done_released_and_rebuilds_the_keywords_it_rewrote(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool)
        assert reextract_worker.run_pass(work, lambda: [_HOTELS, _MOTELS], 'worker-fn') == 'done'
        assert (work.job['status'], work.job['rebuild'], _released(work)) == ('done', 'started', [work.job_id])
        assert invoker.calls == [(_REBUILD_FUNCTION, {
            'action': 'backfill_keyword_run_kpis', 'rebuild': True, 'chain': True, 'then_latest': True, 'keywords': ['hotels'],
        })]

    def test_a_job_that_rewrote_nothing_starts_no_rebuild(self, extract, invoker, pool):
        work = _work([answer_row('hotels', response='FAIL')], pool)
        reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn')
        assert (work.job['rebuild'], invoker.calls) == (None, [])

    def test_a_stopped_job_still_rebuilds_what_it_rewrote(self, extract, invoker, pool):
        work = _stopping_work(pool)
        assert reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn') == 'stopped'
        assert work.job['rebuild'] == 'started'

    def test_brand_extraction_switched_off_fails_the_job_with_the_reason(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool)
        with patch('extraction_settings.get_extraction_config', return_value={'brand_extraction': {'enabled': False}}):
            assert reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn') == 'failed'
        assert work.job['error'] == 'Brand extraction is turned off'

    def test_a_row_dynamodb_refuses_counts_as_failed_and_the_job_goes_on(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool)
        work.search_table.update_error = ClientError({'Error': {'Code': 'ValidationException', 'Message': 'Item size has exceeded the maximum allowed size'}}, 'UpdateItem')
        assert reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn') == 'done'
        assert (work.job['answers_failed'], _released(work)) == (1, [work.job_id])

    def test_a_job_extracts_no_more_answers_than_were_confirmed(self, extract, invoker, pool):
        work = _work([answer_row('hotels', 'claude'), answer_row('hotels', 'openai')], pool, job=_job(answers_total=1, answers_cap=1))
        assert reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn') == 'done'
        assert (len(work.search_table.updates), work.job['capped']) == (1, True)

    def test_a_job_that_covered_everything_is_not_capped(self, extract, invoker, pool):
        work = _work([answer_row('hotels')], pool)
        reextract_worker.run_pass(work, lambda: [_HOTELS], 'worker-fn')
        assert work.job['capped'] is False


class TestHandler:
    @pytest.mark.parametrize('event', [{}, {'job_id': ''}, {'job_id': 'rx-1', 'step': '1'}, {'job_id': 'rx-1', 'step': True}])
    def test_an_event_without_a_job_and_step_is_ignored(self, event):
        assert reextract_worker.handler(event, None) == {'status': 'ignored'}

    @pytest.mark.parametrize(('job', 'step'), [(_job(step=2), 1), (_job(status='done'), 0)])
    def test_an_invocation_for_another_step_or_a_finished_job_does_nothing(self, job, step):
        with (
            patch.object(reextract_worker, 'ReextractJobs', return_value=FakeJobs(job)),
            patch.dict(os.environ, {'DYNAMODB_TABLE_REEXTRACT_JOBS': 'test-jobs'}),
        ):
            assert reextract_worker.handler({'job_id': job['job_id'], 'step': step}, None) == {'status': 'ignored'}
