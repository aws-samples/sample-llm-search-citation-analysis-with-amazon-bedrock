"""Lighthouse run storage (``shared.lighthouse_runs``): receipts, the run view and the recent list."""

from __future__ import annotations

import pytest

from shared import lighthouse_runs
from testing.performance_fixtures import PAGE, install_run_cache, stored_run

TARGETS = [{'url': PAGE, 'device': 'mobile'}, {'url': PAGE, 'device': 'desktop'}]


@pytest.fixture
def memory(monkeypatch):
    return install_run_cache(monkeypatch)


def test_a_new_run_prices_every_target_at_the_live_lighthouse_price():
    assert lighthouse_runs.new_run('batch', TARGETS, 'admin')['estimated_cost_usd'] == 0.01


def test_a_receipt_answers_the_run_it_names(memory):
    run = stored_run(memory, TARGETS)
    lighthouse_runs.put_receipt({'kind': 'single', 'url': PAGE}, run['run_id'])

    reused = lighthouse_runs.receipt_run({'kind': 'single', 'url': PAGE})
    assert reused is not None
    assert reused['run_id'] == run['run_id']


def test_a_receipt_of_a_failed_run_is_ignored(memory):
    run = stored_run(memory, TARGETS, status='failed')
    lighthouse_runs.put_receipt({'kind': 'single', 'url': PAGE}, run['run_id'])

    assert lighthouse_runs.receipt_run({'kind': 'single', 'url': PAGE}) is None


def test_the_view_counts_finished_targets_and_hides_report_keys():
    run = lighthouse_runs.new_run('batch', TARGETS, 'admin')
    run['results'] = [{'status': 'completed', 'raw_key': 'seo/lighthouse/x-0.json'}, {'status': 'measuring'}]

    view = lighthouse_runs.run_view(run)
    assert (view['progress'], view['results'][0]) == ({'done': 1, 'total': 2}, {'status': 'completed'})


def test_remember_run_lists_the_newest_run_first_once(memory):
    first = stored_run(memory, TARGETS)
    second = stored_run(memory, TARGETS)
    for run in (first, second, first):
        lighthouse_runs.remember_run(run)

    assert [header['run_id'] for header in lighthouse_runs.recent_runs()] == [first['run_id'], second['run_id']]


def test_the_report_is_kept_under_the_seo_lighthouse_prefix():
    assert lighthouse_runs.raw_key('abc', 3) == 'seo/lighthouse/abc-3.json'
