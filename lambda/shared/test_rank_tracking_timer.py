"""Tests for a rank tracker's own EventBridge Scheduler schedule."""

from __future__ import annotations

from datetime import timedelta

import pytest

from shared.rank_tracking_timer import sync_schedule
from testing.rank_tracking_fixtures import NOW, tracker
from testing.scheduler_stub import scheduler_stub

NAME = 'rank-rt-example'
GROUP = 'citation-analysis-seo-rank'


@pytest.fixture
def scheduler(monkeypatch):
    return scheduler_stub(monkeypatch)


def test_creates_a_one_time_schedule_at_the_slot_named_after_the_tracker(scheduler):
    sync_schedule(tracker(next_check_at='2026-10-12T06:00:00.000000Z'), NOW, client=scheduler)

    schedule = scheduler.schedules[(GROUP, NAME)]
    assert (schedule['ScheduleExpression'], schedule['ScheduleExpressionTimezone'], schedule['Description'],
            schedule['Target']['RoleArn']) == (
        'at(2026-10-12T06:00:00)', 'UTC', 'example.com (global)', 'arn:aws:iam::123456789012:role/RankScheduler',
    )


def test_moves_an_existing_schedule_in_place(scheduler):
    sync_schedule(tracker(next_check_at='2026-10-12T06:00:00.000000Z'), NOW, client=scheduler)

    sync_schedule(tracker(next_check_at='2026-10-19T06:00:00.000000Z'), NOW, client=scheduler)

    assert (len(scheduler.schedules), scheduler.expression(NAME)) == (1, 'at(2026-10-19T06:00:00)')


def test_fires_a_past_slot_one_minute_from_now(scheduler):
    fires = sync_schedule(tracker(next_check_at='2026-10-05T06:00:00.000000Z'), NOW, client=scheduler)

    assert (fires, scheduler.expression(NAME)) == (NOW + timedelta(minutes=1), 'at(2026-10-05T08:01:00)')


def test_a_retry_time_overrides_the_slot(scheduler):
    sync_schedule(tracker(next_check_at='2026-10-12T06:00:00.000000Z'), NOW, at=NOW + timedelta(minutes=15),
                  client=scheduler)

    assert scheduler.expression(NAME) == 'at(2026-10-05T08:15:00)'


@pytest.mark.parametrize('overrides', [{'is_active': False}, {'schedule': 'manual'}, {'next_check_at': None}])
def test_deletes_the_schedule_of_a_tracker_that_runs_only_on_demand(scheduler, overrides):
    sync_schedule(tracker(next_check_at='2026-10-12T06:00:00.000000Z'), NOW, client=scheduler)

    assert (sync_schedule(tracker(**overrides), NOW, client=scheduler), scheduler.schedules) == (None, {})


def test_deleting_a_schedule_that_does_not_exist_is_not_an_error(scheduler):
    assert sync_schedule(None, NOW, tracker_id='rt-gone', client=scheduler) is None
