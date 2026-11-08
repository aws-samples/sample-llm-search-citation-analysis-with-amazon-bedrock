"""Local SEO job steps (``jobs_local.py``): post once, collect for free, finish or time out."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from shared import dataforseo_business_tasks as business_tasks
from shared import dataforseo_local_serp as local_serp
from shared.dataforseo_client import DataForSeoError
from testing.callback_fixtures import TASK_TOKEN, fake_callback_gates
from testing.local_seo_fixtures import (
    FAILED,
    GRID_REQUEST,
    PENDING,
    REVIEWS_REQUEST,
    collecting_job,
    completed,
    install_memory_cache,
    posted,
    raw_business,
    raw_review,
    reviews_task_result,
    stored_job,
)
from testing.module_loader import load_handler_module

JOBS_DIR = Path(__file__).resolve().parent
ALL_TAGS = {str(index): f'task-{index}' for index in range(9)}
COLLECTORS = {'reviews': 'collect_reviews', 'updates': 'collect_updates'}


@pytest.fixture(scope='module')
def jobs():
    return load_handler_module(str(JOBS_DIR), 'jobs_local.py', 'jobs_local_under_test')


@pytest.fixture
def memory(monkeypatch):
    return install_memory_cache(monkeypatch)


@pytest.fixture
def gates(jobs, monkeypatch):
    return fake_callback_gates(monkeypatch, jobs)


@pytest.fixture
def post_grid(monkeypatch):
    stub = MagicMock(return_value=posted(ALL_TAGS))
    monkeypatch.setattr(local_serp, 'post_grid_tasks', stub)
    return stub


@pytest.fixture
def point_4_refused(monkeypatch):
    """``task_post`` accepting every grid point but the fifth (tag ``4``)."""
    accepted = {tag: task for tag, task in ALL_TAGS.items() if tag != '4'}
    monkeypatch.setattr(local_serp, 'post_grid_tasks', MagicMock(return_value=posted(accepted, {'4': 'Invalid Field'})))


@pytest.fixture
def post(jobs, memory, gates):
    """``post(kind)`` -> ``(answer, stored job)`` of one post step on a new job."""
    def run(kind='grid'):
        job = stored_job(memory, kind, GRID_REQUEST if kind == 'grid' else REVIEWS_REQUEST)
        return jobs.post_step({'job_id': job['job_id'], 'task_token': TASK_TOKEN}), memory.job(job['job_id'])

    return run


@pytest.fixture
def collect(jobs, memory, monkeypatch):
    """``collect(kind, outcome, attempt=0)`` -> ``(answer, stored job)``; an exception ``outcome`` is raised."""
    def run(kind, outcome, attempt=0):
        stub = MagicMock(side_effect=outcome) if isinstance(outcome, Exception) else MagicMock(return_value=outcome)
        if kind == 'grid':
            monkeypatch.setattr(local_serp, 'collect_grid_task', stub)
            job = collecting_job(memory, 'grid', ALL_TAGS)
        else:
            monkeypatch.setattr(business_tasks, COLLECTORS[kind], stub)
            job = collecting_job(memory, kind, {'business': 't'})
        return jobs.collect_step({'job_id': job['job_id'], 'attempt': attempt}), memory.job(job['job_id'])

    return run


class TestPost:
    def test_posts_one_maps_task_per_grid_point(self, post, post_grid):
        post()

        assert len(post_grid.call_args.args[0]) == 9

    def test_marks_the_job_collecting_with_every_point_pending(self, post, post_grid):
        answer, stored = post()

        assert (answer['done'], stored['status'], len(stored['pending'])) == (False, 'collecting', 9)

    def test_never_posts_again_when_the_job_already_holds_task_ids(self, jobs, memory, post_grid, gates):
        job = collecting_job(memory, 'grid', ALL_TAGS)

        jobs.post_step({'job_id': job['job_id'], 'task_token': TASK_TOKEN})

        assert (post_grid.call_count, [token for token, _answer in gates.released]) == (0, [TASK_TOKEN])

    def test_waits_for_one_callback_per_accepted_grid_point(self, post, post_grid, gates):
        post()

        (gate_id,) = gates.gates
        assert (gates.only_gate['remaining'], gates.released, post_grid.call_args.kwargs['pingback_url']) == (
            9, [], f'https://callbacks.example/?gate={gate_id}&id=$id')

    @pytest.mark.usefixtures('point_4_refused')
    def test_does_not_wait_for_a_point_refused_at_post_time(self, post, gates):
        post()

        assert gates.only_gate['remaining'] == 8

    def test_resumes_at_once_after_a_failed_post(self, post, monkeypatch, gates):
        monkeypatch.setattr(business_tasks, 'post_reviews', MagicMock(side_effect=DataForSeoError('BILLING_ISSUE', 'low')))

        post('reviews')

        assert gates.released[0][1]['done'] is True

    @pytest.mark.usefixtures('point_4_refused')
    def test_marks_rejected_points_failed_at_post_time(self, post):
        assert post()[1]['results']['points']['4'] == {'status': 'failed', 'message': 'Invalid Field'}

    def test_fails_the_job_with_the_error_code_when_the_post_fails(self, post, monkeypatch):
        monkeypatch.setattr(business_tasks, 'post_reviews', MagicMock(side_effect=DataForSeoError('BILLING_ISSUE', 'low')))

        answer, stored = post('reviews')

        assert (answer['done'], stored['error_code']) == (True, 'BILLING_ISSUE')

    def test_raises_for_a_job_the_cache_does_not_hold(self, jobs, memory):
        with pytest.raises(jobs.MissingJobError, match='gone'):
            jobs.post_step({'job_id': 'gone', 'task_token': TASK_TOKEN})


class TestCollect:
    def test_completes_a_reviews_job_with_its_results(self, collect):
        stored = collect('reviews', completed(reviews_task_result(raw_review(5))))[1]

        assert (stored['status'], stored['results']['summary']['histogram']['5']) == ('completed', 1)

    def test_times_out_keeping_the_task_ids_when_a_task_is_still_running(self, collect):
        answer, stored = collect('updates', PENDING)

        assert (answer['done'], stored['status'], stored['tasks']) == (True, 'timed_out', {'business': 't'})

    def test_leaves_a_task_pending_when_its_free_task_get_fails(self, collect):
        stored = collect('reviews', DataForSeoError('UPSTREAM_UNAVAILABLE', 'x'))[1]

        assert (stored['pending'], stored['status']) == (['business'], 'timed_out')

    def test_fails_a_reviews_job_whose_task_failed(self, collect):
        assert collect('reviews', FAILED)[1]['status'] == 'failed'

    def test_stores_each_ready_grid_point_and_completes_the_grid(self, collect):
        stored = collect('grid', completed({'items': [raw_business()]}))[1]

        assert (stored['status'], stored['results']['points']['0']['results'][0]['cid']) == ('completed', '1234567890')

    def test_fails_the_grid_when_every_point_failed(self, jobs, collect):
        assert collect('grid', FAILED)[1]['error'] == jobs.GRID_FAILED_MESSAGE


class TestFail:
    def test_marks_a_running_job_failed(self, jobs, memory):
        job = collecting_job(memory, 'grid', ALL_TAGS)

        jobs.fail_step({'job_id': job['job_id'], 'error': {'Error': 'Lambda.Unknown'}})

        assert memory.job(job['job_id'])['status'] == 'failed'

    def test_keeps_a_completed_job_completed(self, jobs, memory):
        job = stored_job(memory, 'grid', GRID_REQUEST, status='completed')

        jobs.fail_step({'job_id': job['job_id']})

        assert memory.job(job['job_id'])['status'] == 'completed'


def test_registers_the_three_local_steps(jobs):
    assert sorted(jobs.STEPS) == ['local.collect', 'local.fail', 'local.post']
