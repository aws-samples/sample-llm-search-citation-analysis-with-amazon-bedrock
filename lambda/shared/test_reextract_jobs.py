"""The re-extract job store (``shared.reextract_jobs``): one active job per deployment, step-guarded progress."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from shared.reextract_jobs import ReextractJobs, StaleStepError, is_stale, job_view, new_job_item
from testing.reextract_fakes import JobTable


def _item(**overrides):
    item = new_job_item({'group_ids': ['g1']}, 'admin@example.com', answers=10, keywords=2, cost=0.011, brands_version=2)
    item.update(overrides)
    return item


@pytest.fixture
def jobs() -> ReextractJobs:
    return ReextractJobs(JobTable())


@pytest.fixture
def finished(jobs):
    """A job that ran and is done (the pointer still names it)."""
    job, _ = jobs.start(_item())
    return jobs.save(job['job_id'], 0, {'status': 'done'})


class TestStart:
    def test_the_first_job_becomes_the_active_one(self, jobs):
        job, _ = jobs.start(_item())
        assert jobs.current() == (job, True)

    def test_a_second_start_is_refused_with_the_running_job(self, jobs):
        first, _ = jobs.start(_item())
        assert jobs.start(_item()) == (None, first)

    def test_a_refused_job_leaves_no_item_behind(self, jobs):
        jobs.start(_item())
        refused = _item()
        jobs.start(refused)
        assert jobs.get(refused['job_id']) is None

    def test_a_job_can_start_once_the_previous_one_is_released(self, jobs, finished):
        jobs.release(finished['job_id'])
        second, refused = jobs.start(_item())
        assert (second is not None, refused) == (True, None)

    def test_a_stale_active_job_is_replaced_and_marked_failed(self, jobs):
        stale, _ = jobs.start(_item(updated_at='2026-01-01T00:00:00.000000Z'))
        jobs.start(_item())
        assert jobs.get(stale['job_id'])['status'] == 'failed'

    def test_job_ids_are_rx_and_hex(self):
        assert _item()['job_id'].startswith('rx-')


class TestCurrent:
    def test_no_job_yet_reads_as_none_and_inactive(self, jobs):
        assert jobs.current() == (None, False)

    def test_a_finished_job_is_the_newest_but_not_active(self, jobs, finished):
        newest, active = jobs.current()
        assert (newest['job_id'], newest['status'], active) == (finished['job_id'], 'done', False)

    def test_the_pointer_item_is_never_read_as_a_job(self, jobs):
        jobs.start(_item())
        assert jobs.get('current') is None


class TestStopAndSave:
    def test_stop_moves_a_running_job_to_stopping(self, jobs):
        job, _ = jobs.start(_item())
        assert jobs.request_stop(job['job_id'])['status'] == 'stopping'

    def test_stop_answers_a_finished_job_as_it_is(self, jobs, finished):
        assert jobs.request_stop(finished['job_id'])['status'] == 'done'

    def test_stop_of_an_unknown_job_answers_none(self, jobs):
        assert jobs.request_stop('rx-missing') is None

    def test_save_at_another_step_raises_stale_step(self, jobs):
        job, _ = jobs.start(_item())
        with pytest.raises(StaleStepError, match=job['job_id']):
            jobs.save(job['job_id'], 1, {'answers_done': 3})

    def test_save_adds_the_touched_keywords(self, jobs):
        job, _ = jobs.start(_item())
        jobs.save(job['job_id'], 0, {}, {'hotels'})
        assert jobs.save(job['job_id'], 0, {}, {'motels'})['touched_keywords'] == {'hotels', 'motels'}


class TestJobView:
    def test_shows_counts_as_integers_and_the_cost_as_a_number(self):
        view = job_view(_item(answers_done=Decimal(4)))
        assert (view['answers_done'], view['estimated_cost_usd'], view['status']) == (4, 0.011, 'running')

    def test_hides_the_workers_bookkeeping(self):
        assert {'step', 'cursor_keyword', 'cursor_key', 'touched_keywords', 'answers_cap'} & job_view(_item()).keys() == set()


_NOW = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(('minutes', 'stale'), [(5, False), (19, False), (21, True)])
def test_a_job_is_stale_after_twenty_minutes_without_a_save(minutes, stale):
    stamp = (_NOW - timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    assert is_stale({'updated_at': stamp}, _NOW) is stale
