"""Tests for ``rank.due``: a tracker's own schedule fires, its check starts and the schedule moves on."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared import rank_tracking_scheduler
from shared.rank_tracking_runs import begin_run
from shared.rank_tracking_scheduler import run_due
from shared.rank_tracking_store import TrackedKeyword, Tracker, get_tracker
from testing.rank_tracking_fixtures import NOW, RankTable, stored_tracker, tracker
from testing.scheduler_stub import SchedulerStub, scheduler_stub

DUE = '2026-10-05T06:00:00.000000Z'
NEXT_WEEK = '2026-10-12T06:00:00.000000Z'
NAME = 'rank-rt-example'


class StartFailedError(RuntimeError):
    """The state machine refused to start."""


@pytest.fixture
def keywords(monkeypatch):
    found = MagicMock(return_value=[TrackedKeyword('k', 'cheap flights', 'list')])
    monkeypatch.setattr(rank_tracking_scheduler, 'resolve_run_keywords', found)
    return found


@pytest.fixture
def table():
    """The table holding one weekly tracker due at ``DUE``."""
    memory = RankTable()
    stored_tracker(memory, next_check_at=DUE)
    return memory


@pytest.fixture
def scheduler(monkeypatch):
    return scheduler_stub(monkeypatch)


def _stored(table: RankTable) -> Tracker:
    stored = get_tracker(table, 'rt-example')
    assert stored is not None
    return stored


def _due(table: RankTable, scheduler: SchedulerStub, start: MagicMock | None = None) -> tuple[str, str | None]:
    """``(outcome, next_check_at)`` after the tracker's schedule fired once."""
    summary = run_due(table, MagicMock(), start or MagicMock(), 'rt-example', NOW, scheduler)
    return summary['outcome'], _stored(table).next_check_at


def test_starts_a_due_tracker_and_advances_it_from_its_slot(table, keywords, scheduler):
    start = MagicMock()

    assert (*_due(table, scheduler, start), start.call_count) == ('started', NEXT_WEEK, 1)


def test_moves_the_schedule_to_the_next_slot_after_starting(table, keywords, scheduler):
    _due(table, scheduler)

    assert (scheduler.expression(NAME), scheduler.target_input(NAME)) == (
        'at(2026-10-12T06:00:00)', {'step': 'rank.due', 'tracker_id': 'rt-example'},
    )


def test_moves_the_schedule_to_a_later_slot_without_running(keywords, scheduler):
    later = RankTable()
    stored_tracker(later, next_check_at='2026-10-05T09:00:00.000000Z')
    start = MagicMock()

    outcome = run_due(later, MagicMock(), start, 'rt-example', NOW, scheduler)['outcome']

    assert (outcome, start.call_count, scheduler.expression(NAME)) == ('not_due', 0, 'at(2026-10-05T09:00:00)')


@pytest.mark.parametrize('overrides', [{'is_active': False}, {'schedule': 'manual'}, None])
def test_deletes_the_schedule_of_an_archived_manual_or_deleted_tracker(keywords, scheduler, overrides):
    idle = RankTable()
    if overrides is not None:
        stored_tracker(idle, next_check_at=DUE, **overrides)
    scheduler.create_schedule(Name=NAME, GroupName='citation-analysis-seo-rank')

    outcome = run_due(idle, MagicMock(), MagicMock(), 'rt-example', NOW, scheduler)['outcome']

    assert (outcome, scheduler.expression(NAME)) == ('not_scheduled', None)


def test_advances_a_tracker_without_keywords_and_records_why(table, keywords, scheduler):
    keywords.return_value = []

    _due(table, scheduler)

    assert (_stored(table).next_check_at, _stored(table).last_skip_reason) == (NEXT_WEEK, 'no_keywords')


def test_puts_the_slot_back_and_fires_again_later_when_a_run_is_still_active(table, keywords, scheduler):
    begin_run(table, MagicMock(), tracker(), 'manual', NOW)

    assert (*_due(table, scheduler), scheduler.expression(NAME)) == ('already_running', DUE, 'at(2026-10-05T08:15:00)')


def test_keeps_the_schedule_advanced_when_the_state_machine_does_not_start(table, keywords, scheduler):
    outcome = _due(table, scheduler, MagicMock(side_effect=StartFailedError('down')))

    assert (outcome, scheduler.expression(NAME)) == (('start_failed', NEXT_WEEK), 'at(2026-10-12T06:00:00)')


def test_leaves_the_tracker_due_and_fires_again_later_when_reading_its_keywords_fails(table, keywords, scheduler):
    keywords.side_effect = StartFailedError('keywords table down')

    assert (*_due(table, scheduler), scheduler.expression(NAME)) == ('error', DUE, 'at(2026-10-05T08:15:00)')


def test_reports_a_claim_lost_to_an_edit(table, keywords, scheduler, monkeypatch):
    edited = tracker(next_check_at=DUE, version=0)
    monkeypatch.setattr(rank_tracking_scheduler, 'get_tracker', MagicMock(side_effect=[edited, _stored(table)]))

    assert run_due(table, MagicMock(), MagicMock(), 'rt-example', NOW, scheduler)['outcome'] == 'claim_lost'


def test_starts_the_scheduled_run_on_the_queue(table, keywords, scheduler):
    start = MagicMock()

    _due(table, scheduler, start)

    run_id = start.call_args.args[0]
    assert table.get_item(Key={'pk': 'TRACKER#rt-example', 'sk': f'RUN#{run_id}'})['Item']['method'] == 'queued'
