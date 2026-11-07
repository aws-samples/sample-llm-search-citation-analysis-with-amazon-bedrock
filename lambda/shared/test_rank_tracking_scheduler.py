"""Tests for the scheduler tick."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shared import rank_tracking_scheduler
from shared.rank_tracking_runs import begin_run
from shared.rank_tracking_scheduler import tick
from shared.rank_tracking_store import TrackedKeyword, Tracker, get_tracker
from testing.rank_tracking_fixtures import NOW, RankTable, stored_tracker, tracker

DUE = '2026-10-05T06:00:00.000000Z'
NEXT_WEEK = '2026-10-12T06:00:00.000000Z'


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


def _stored(table: RankTable) -> Tracker:
    stored = get_tracker(table, 'rt-example')
    assert stored is not None
    return stored


def _tick(table: RankTable, start: MagicMock | None = None) -> tuple[dict[str, int], str | None]:
    """``(summary, next_check_at)`` after one tick."""
    summary = tick(table, MagicMock(), start or MagicMock(), NOW)
    return summary, _stored(table).next_check_at


def test_starts_a_due_tracker_and_advances_it_from_its_slot(table, keywords):
    start = MagicMock()

    assert (*_tick(table, start), start.call_count) == ({'started': 1}, NEXT_WEEK, 1)


def test_leaves_a_tracker_whose_slot_is_later_alone(keywords):
    later = RankTable()
    stored_tracker(later, next_check_at='2026-10-05T09:00:00.000000Z')

    assert tick(later, MagicMock(), MagicMock(), NOW) == {}


def test_ignores_an_archived_or_manual_tracker(keywords):
    idle = RankTable()
    stored_tracker(idle, tracker_id='a', is_active=False, next_check_at=DUE)
    stored_tracker(idle, tracker_id='b', schedule='manual', next_check_at=DUE)

    assert tick(idle, MagicMock(), MagicMock(), NOW) == {}


def test_advances_a_tracker_without_keywords_and_records_why(table, keywords):
    keywords.return_value = []

    _tick(table)

    assert (_stored(table).next_check_at, _stored(table).last_skip_reason) == (NEXT_WEEK, 'no_keywords')


def test_puts_the_slot_back_when_a_run_is_still_active(table, keywords):
    begin_run(table, MagicMock(), tracker(), 'manual', NOW)

    assert _tick(table) == ({'already_running': 1}, DUE)


def test_keeps_the_schedule_advanced_when_the_state_machine_does_not_start(table, keywords):
    assert _tick(table, MagicMock(side_effect=StartFailedError('down'))) == ({'start_failed': 1}, NEXT_WEEK)


def test_leaves_the_tracker_due_when_reading_its_keywords_fails(table, keywords):
    keywords.side_effect = StartFailedError('keywords table down')

    assert _tick(table) == ({'error': 1}, DUE)


def test_skips_a_tracker_edited_since_the_tick_read_it(table, keywords, monkeypatch):
    edited = tracker(next_check_at=DUE, version=0)
    monkeypatch.setattr(rank_tracking_scheduler, 'due_trackers', lambda _table, _now: [edited])

    assert _tick(table)[0] == {'claim_lost': 1}


def test_starts_the_scheduled_run_on_the_queue(table, keywords):
    start = MagicMock()

    _tick(table, start)

    run_id = start.call_args.args[0]
    assert table.get_item(Key={'pk': 'TRACKER#rt-example', 'sk': f'RUN#{run_id}'})['Item']['method'] == 'queued'
