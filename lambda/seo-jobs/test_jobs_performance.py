"""Lighthouse run steps (``jobs_performance.py``): one paid target per step, never measured twice."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from shared import lighthouse_runs
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_lighthouse import ChargedReportError, LighthouseRun
from testing.module_loader import load_handler_module
from testing.performance_fixtures import PAGE, install_run_cache, saved_run, stored_run

JOBS_DIR = Path(__file__).resolve().parent
TARGETS = [{'url': PAGE, 'device': 'mobile'}, {'url': PAGE, 'device': 'desktop'}]
SUMMARY = {'final_url': PAGE, 'lighthouse_version': '12.6.0', 'scores': {'seo': 100}, 'metrics': {}, 'failed_audits': []}


@pytest.fixture(scope='module')
def jobs():
    return load_handler_module(str(JOBS_DIR), 'jobs_performance.py', 'jobs_performance_under_test')


@pytest.fixture
def memory(monkeypatch):
    return install_run_cache(monkeypatch)


@pytest.fixture
def lighthouse(jobs, monkeypatch):
    stub = MagicMock(return_value=LighthouseRun(summary=SUMMARY, report={'audits': {}}, task_id='t-1', cost_usd=0.005))
    monkeypatch.setattr(jobs, 'run_lighthouse', stub)
    return stub


@pytest.fixture
def s3(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(lighthouse_runs, '_s3', lambda: client)
    monkeypatch.setenv('SEO_BUCKET', 'test-raw-responses')
    return client


@pytest.fixture
def one_step(jobs, memory, lighthouse, s3):
    """A two-target run after its first measure step: ``(run_id, step answer)``."""
    run = stored_run(memory, TARGETS)
    return run['run_id'], jobs.measure_step({'run_id': run['run_id']})


def test_measures_the_first_target_and_answers_that_more_remain(one_step, lighthouse):
    run_id, answer = one_step

    assert (answer, lighthouse.call_args.args) == ({'run_id': run_id, 'done': False}, (PAGE, 'mobile'))


def test_keeps_the_full_report_in_s3_under_the_run_id(one_step, s3):
    run_id, _answer = one_step

    assert s3.put_object.call_args.kwargs['Key'] == f'seo/lighthouse/{run_id}-0.json'


def test_stores_the_summary_and_cost_on_the_run(one_step, memory):
    saved = saved_run(memory, one_step[0])
    assert (saved['results'][0]['scores'], saved['results'][0]['status'], saved['cost_usd']) == (
        {'seo': 100}, 'completed', 0.005)


def test_completes_the_run_after_the_last_target(jobs, memory, lighthouse, s3):
    run = stored_run(memory, TARGETS)

    answers = [jobs.measure_step({'run_id': run['run_id']})['done'] for _ in TARGETS]

    assert (answers, saved_run(memory, run['run_id'])['status']) == ([False, True], 'completed')


def test_never_measures_a_target_that_already_has_a_result(jobs, memory, lighthouse, s3):
    run = stored_run(memory, TARGETS, results=[{'status': 'measuring'}, None])

    jobs.measure_step({'run_id': run['run_id']})

    assert lighthouse.call_args.args == (PAGE, 'desktop')


def test_records_a_refused_call_on_its_target_and_goes_on(jobs, memory, lighthouse, s3):
    lighthouse.side_effect = DataForSeoError('BILLING_ISSUE', 'balance')
    run = stored_run(memory, TARGETS)

    answer = jobs.measure_step({'run_id': run['run_id']})

    result = saved_run(memory, run['run_id'])['results'][0]
    assert (answer['done'], result['status'], result['error']) == (
        False, 'failed', 'The DataForSEO account balance is too low')


def test_records_the_cost_of_a_billed_answer_without_a_report(jobs, memory, lighthouse, s3):
    lighthouse.side_effect = ChargedReportError('no scores', 0.005)
    run = stored_run(memory, TARGETS)

    jobs.measure_step({'run_id': run['run_id']})

    assert saved_run(memory, run['run_id'])['cost_usd'] == 0.005


def test_does_nothing_for_a_finished_run(jobs, memory, lighthouse, s3):
    run = stored_run(memory, TARGETS, status='failed')

    assert (jobs.measure_step({'run_id': run['run_id']})['done'], lighthouse.call_count) == (True, 0)


def test_raises_for_an_unknown_run(jobs, memory):
    with pytest.raises(jobs.MissingRunError):
        jobs.measure_step({'run_id': 'missing'})


def test_fail_marks_the_run_and_its_interrupted_target_failed(jobs, memory):
    run = stored_run(memory, TARGETS, status='running', results=[{**TARGETS[0], 'status': 'measuring'}, None])

    jobs.fail_step({'run_id': run['run_id'], 'error': {'Error': 'States.Timeout'}})

    saved = saved_run(memory, run['run_id'])
    assert (saved['status'], saved['results'][0]['status']) == ('failed', 'failed')


def test_steps_are_registered_under_the_lighthouse_prefix(jobs):
    assert sorted(jobs.STEPS) == ['lighthouse.fail', 'lighthouse.measure']
