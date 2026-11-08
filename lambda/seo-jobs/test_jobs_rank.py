"""Tests for the rank tracking steps of the SEO jobs function, run against an in-memory table."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import jobs_rank

from shared.dataforseo_client import DataForSeoError
from shared.rank_tracking_runs import begin_run, get_run, load_pairs, load_states
from shared.rank_tracking_store import TrackedKeyword, get_tracker
from testing.rank_tracking_fixtures import (
    CODES,
    NOW,
    RankTable,
    fake_live_checks,
    fake_task_polls,
    fake_task_posts,
    organic,
    serp_result,
    stored_tracker,
)

KEYWORDS = [TrackedKeyword('kw-a', 'cheap flights', 'list')]


@pytest.fixture
def table(monkeypatch):
    memory = RankTable()
    monkeypatch.setattr(jobs_rank, 'rank_table', lambda: memory)
    monkeypatch.setattr(jobs_rank, 'keywords_table', MagicMock)
    monkeypatch.setattr(jobs_rank, 'market_codes_for', lambda _market_id: CODES)
    monkeypatch.setattr(jobs_rank, 'resolve_run_keywords', lambda _table, _keywords, _tracker: list(KEYWORDS))
    monkeypatch.setattr(jobs_rank, 'utc_now', lambda: NOW)
    return memory


def _start(table: RankTable, trigger: str = 'manual', **tracker_fields) -> dict:
    tracker = stored_tracker(table, devices='desktop', **tracker_fields)
    run, _blocking = begin_run(table, MagicMock(), tracker, trigger, NOW)
    assert run is not None
    return {'tracker_id': tracker.tracker_id, 'run_id': run['run_id']}


def _scheduled(table: RankTable) -> dict:
    """A scheduled run, prepared and with its pairs queued as task ``t-1``."""
    return jobs_rank.post(jobs_rank.prepare(_start(table, trigger='scheduled')))


def _run(table: RankTable, state: dict) -> dict:
    return get_run(table, state['tracker_id'], state['run_id']) or {}


def test_prepare_sends_a_manual_run_to_live_checks(table):
    assert _step_outcome(table, jobs_rank.prepare, _start(table)) == ('live', 'running')


def test_prepare_sends_a_scheduled_run_to_the_queue(table):
    assert jobs_rank.prepare(_start(table, trigger='scheduled'))['next'] == 'queued'


def test_prepare_writes_one_pair_per_keyword_and_device(table):
    state = _start(table)
    jobs_rank.prepare(state)

    assert [pair['sk'] for pair in load_pairs(table, state['run_id'])] == ['PAIR#kw-a#desktop']


def test_prepare_stops_a_run_that_is_no_longer_pending(table):
    state = _start(table)
    jobs_rank.prepare(state)

    assert jobs_rank.prepare(state)['next'] == 'stop'


def _step_outcome(table: RankTable, step, state: dict) -> tuple[str, str | None]:
    """``(next, run status)`` after ``step`` runs on ``state``."""
    return step(state)['next'], _run(table, state).get('status')


def test_prepare_fails_the_run_of_an_archived_tracker(table):
    assert _step_outcome(table, jobs_rank.prepare, _start(table, is_active=False)) == ('stop', 'failed')


def test_prepare_fails_a_run_without_keywords(table, monkeypatch):
    monkeypatch.setattr(jobs_rank, 'resolve_run_keywords', lambda *_args: [])
    state = _start(table)

    jobs_rank.prepare(state)

    assert _run(table, state).get('error_code') == 'NO_KEYWORDS'


def test_a_found_keyword_on_its_first_check_completes_without_rechecks(table, monkeypatch):
    fake_live_checks(monkeypatch)
    state = jobs_rank.plan_retry(jobs_rank.live(jobs_rank.prepare(_start(table))))

    assert (state['next'], jobs_rank.finalize(state)['status']) == ('finalize', 'completed')


def test_finalize_records_the_check_on_the_tracker_and_frees_it(table, monkeypatch):
    fake_live_checks(monkeypatch)
    jobs_rank.finalize(jobs_rank.plan_retry(jobs_rank.live(jobs_rank.prepare(_start(table)))))
    stored = get_tracker(table, 'rt-example')
    assert stored is not None

    assert (stored.last_checked_at, begin_run(table, MagicMock(), stored, 'manual', NOW)[0] is not None) == (
        '2026-10-05T08:00:00.000000Z', True)


def test_a_first_check_miss_is_rechecked_through_the_queue(table, monkeypatch):
    fake_live_checks(monkeypatch, position=None)
    fake_task_posts(monkeypatch, {'kw-a#desktop': 't-1'})
    fake_task_polls(monkeypatch, 'completed', serp_result(organic(12, 'example.com')))

    state = jobs_rank.plan_retry(jobs_rank.live(jobs_rank.prepare(_start(table))))
    state = jobs_rank.collect(jobs_rank.post(state))
    jobs_rank.finalize(state)

    assert (state['round'], load_states(table, 'rt-example')['kw-a']['desktop']['position']) == (1, 12)


def test_post_waits_four_minutes_before_the_first_poll(table, monkeypatch):
    fake_task_posts(monkeypatch, {'kw-a#desktop': 't-1'})

    state = _scheduled(table)

    assert (state['next'], state['wait_index'], state['wait_seconds']) == ('wait', 0, 240)


def test_post_moves_on_to_rechecks_when_nothing_was_queued(table, monkeypatch):
    fake_task_posts(monkeypatch)

    assert _scheduled(table)['next'] == 'retry'


def test_collect_waits_for_the_next_poll_while_tasks_run(table, monkeypatch):
    fake_task_posts(monkeypatch, {'kw-a#desktop': 't-1'})
    fake_task_polls(monkeypatch, 'pending')

    state = jobs_rank.collect(_scheduled(table))

    assert (state['next'], state['wait_index'], state['wait_seconds']) == ('wait', 1, 120)


def test_collect_moves_on_to_rechecks_after_the_last_poll(table, monkeypatch):
    fake_task_polls(monkeypatch, 'pending')
    state = jobs_rank.prepare(_start(table, trigger='scheduled'))

    assert jobs_rank.collect({**state, 'wait_index': 5})['next'] == 'retry'


def test_stops_rechecking_after_two_rounds(table):
    state = jobs_rank.prepare(_start(table))

    assert jobs_rank.plan_retry({**state, 'round': 2})['next'] == 'finalize'


def test_a_balance_failure_fails_the_run_with_its_code(table, monkeypatch):
    fake_live_checks(monkeypatch).side_effect = DataForSeoError('BILLING_ISSUE', 'balance')

    state = jobs_rank.live(jobs_rank.prepare(_start(table)))
    jobs_rank.finalize(state)

    assert (state['next'], _run(table, state).get('status'), _run(table, state).get('error_code')) == (
        'finalize', 'failed', 'BILLING_ISSUE')


def test_finalize_never_resurrects_a_run_that_already_failed(table, monkeypatch):
    fake_live_checks(monkeypatch)
    state = jobs_rank.live(jobs_rank.prepare(_start(table)))
    jobs_rank.fail(state)

    assert _step_outcome(table, jobs_rank.finalize, state) == ('stop', 'failed')


def test_registers_every_rank_step():
    assert sorted(jobs_rank.STEPS) == ['rank.collect', 'rank.due', 'rank.fail', 'rank.finalize', 'rank.live',
                                       'rank.plan_retry', 'rank.post', 'rank.prepare']


def test_reads_the_run_state_a_state_machine_task_sends(table):
    state = _start(table)

    assert jobs_rank.STEPS['rank.prepare']({'step': 'rank.prepare', 'state': state})['next'] == 'live'


def test_due_runs_the_fired_trackers_check(table, monkeypatch):
    run_due = MagicMock(return_value={'outcome': 'started'})
    monkeypatch.setattr(jobs_rank, 'run_due', run_due)

    jobs_rank.STEPS['rank.due']({'step': 'rank.due', 'tracker_id': 'rt-example'})

    assert (run_due.call_args.args[0], run_due.call_args.args[3], run_due.call_args.args[4]) == (table, 'rt-example', NOW)
