"""Tests for the paid checks of a run (live, queued post) and the free collection of queued tasks."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared import rank_tracking_checks
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_tasks import PostedTasks, TaskOutcome
from shared.rank_tracking_checks import CheckProgress, collect_queued, post_pending, run_live
from shared.rank_tracking_runs import load_pairs, save_items
from testing.rank_tracking_fixtures import (
    CODES,
    RankTable,
    fake_live_checks,
    fake_task_posts,
    organic,
    pair,
    serp_result,
    tracker,
)

DESKTOP = tracker(devices='desktop')


def _pending(count: int, **fields) -> RankTable:
    """A run with ``count`` desktop pairs ``k000``, ``k001`` ... carrying ``fields``."""
    table = RankTable()
    save_items(table, [pair(f'k{index:03d}', 'desktop', **fields) for index in range(count)])
    return table


def _pairs(table: RankTable) -> list[dict]:
    return load_pairs(table, 'run-1')


def _live(table: RankTable) -> CheckProgress:
    return run_live(table, DESKTOP, CODES, _pairs(table))


def _post(table: RankTable) -> CheckProgress:
    return post_pending(table, DESKTOP, CODES, _pairs(table))


def _collect(table: RankTable, outcome: TaskOutcome, *, last_poll: bool = False) -> tuple[CheckProgress, MagicMock]:
    read = MagicMock(return_value=outcome)
    return collect_queued(table, DESKTOP, _pairs(table), last_poll=last_poll, read=read), read


QUEUED = {'status': 'queued', 'task_id': 't-1'}
RUNNING = TaskOutcome('pending', None, None)


def test_live_checks_only_pending_pairs(monkeypatch):
    check = fake_live_checks(monkeypatch)
    table = _pending(1)
    save_items(table, [pair('b', 'desktop', status='answered', answered=True, position=2)])

    _live(table)

    check.assert_called_once_with('keyword k000', CODES, 'desktop', 30, 'example.com')


def test_live_stores_the_found_position(monkeypatch):
    fake_live_checks(monkeypatch, position=5)
    table = _pending(1)

    _live(table)

    assert _pairs(table)[0]['position'] == 5


def test_live_leaves_a_failed_check_unanswered_as_an_error(monkeypatch):
    fake_live_checks(monkeypatch).side_effect = DataForSeoError('UPSTREAM_UNAVAILABLE', 'down')
    table = _pending(1)

    _live(table)

    assert (_pairs(table)[0]['status'], _pairs(table)[0]['error_code']) == ('error', 'UPSTREAM_UNAVAILABLE')


def test_live_stops_calling_after_a_balance_failure(monkeypatch):
    check = fake_live_checks(monkeypatch)
    check.side_effect = DataForSeoError('BILLING_ISSUE', 'balance')
    table = _pending(12)

    progress = _live(table)

    assert (progress.fatal_code, check.call_count, {item['status'] for item in _pairs(table)}) == (
        'BILLING_ISSUE', 10, {'error'})


def test_live_returns_the_rest_when_the_step_runs_out_of_time(monkeypatch):
    check = fake_live_checks(monkeypatch)
    ticks = iter([0.0, 0.0, 10_000.0])
    monkeypatch.setattr(rank_tracking_checks, '_clock', lambda: next(ticks))

    progress = _live(_pending(15))

    assert (progress.remaining, check.call_count) == (5, 10)


def test_queues_pending_pairs_with_their_tags(monkeypatch):
    post = fake_task_posts(monkeypatch, {'k000#desktop': 't-1'})
    table = _pending(1)

    _post(table)

    assert (post.call_args.args[1][0]['tag'], _pairs(table)[0]['task_id']) == ('k000#desktop', 't-1')


def test_posts_one_hundred_tasks_at_a_time(monkeypatch):
    post = fake_task_posts(monkeypatch)

    _post(_pending(150))

    assert [len(call.args[1]) for call in post.call_args_list] == [100, 50]


def test_marks_a_task_the_post_did_not_accept_as_an_error(monkeypatch):
    fake_task_posts(monkeypatch)
    table = _pending(1)

    _post(table)

    assert _pairs(table)[0]['error_code'] == 'REJECTED'


def test_keeps_posting_after_one_post_fails(monkeypatch):
    post = fake_task_posts(monkeypatch)
    post.side_effect = [DataForSeoError('UPSTREAM_UNAVAILABLE', 'down'),
                        PostedTasks(accepted={'k100#desktop': 't-9'}, rejected={}, cost_usd=0.0)]
    table = _pending(101)

    _post(table)

    assert (post.call_count, _pairs(table)[-1]['status']) == (2, 'queued')


def test_never_reposts_a_pair_already_sent(monkeypatch):
    post = fake_task_posts(monkeypatch)

    _post(_pending(1, status='sent'))

    post.assert_not_called()


def test_collects_a_completed_task_into_its_pair():
    table = _pending(1, **QUEUED)

    _collect(table, TaskOutcome('completed', serp_result(organic(7, 'example.com')), None))

    assert (_pairs(table)[0]['position'], _pairs(table)[0]['status']) == (7, 'answered')


def test_keeps_a_running_task_queued_until_the_last_poll():
    table = _pending(1, **QUEUED)

    progress, _read = _collect(table, RUNNING)

    assert (progress.remaining, _pairs(table)[0]['status']) == (1, 'queued')


def test_drops_a_running_task_after_the_last_poll():
    table = _pending(1, **QUEUED)

    progress, _read = _collect(table, RUNNING, last_poll=True)

    assert (progress.remaining, _pairs(table)[0]['error_code']) == (0, 'TASK_TIMEOUT')


def test_reads_at_most_five_hundred_tasks_per_step():
    progress, read = _collect(_pending(501, **QUEUED), RUNNING, last_poll=True)

    assert (read.call_count, progress.capped, progress.remaining) == (500, True, 501)


@pytest.mark.parametrize('code', ['RATE_LIMITED', 'UPSTREAM_UNAVAILABLE'])
def test_treats_a_failed_poll_as_still_pending(monkeypatch, code):
    monkeypatch.setattr(rank_tracking_checks, 'get_task', MagicMock(side_effect=DataForSeoError(code, 'slow')))
    table = _pending(1, **QUEUED)

    assert collect_queued(table, DESKTOP, _pairs(table), last_poll=False).remaining == 1
