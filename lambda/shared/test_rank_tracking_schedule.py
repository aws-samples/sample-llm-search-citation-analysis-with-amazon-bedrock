"""Tests for the rank tracker schedule maths."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from shared import rank_tracking_schedule
from shared.rank_tracking_schedule import format_timestamp, next_check_at, parse_timestamp


def _at(year: int, month: int, day: int, hour: int = 6, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


class _FixedRandom:
    """Always picks the low end of a range."""

    def randint(self, low: int, _high: int) -> int:
        return low


@pytest.fixture
def fixed_random(monkeypatch):
    monkeypatch.setattr(rank_tracking_schedule, '_rng', _FixedRandom())


def test_never_schedules_a_manual_tracker():
    assert next_check_at('manual', None, _at(2026, 10, 5)) is None


@pytest.mark.usefixtures('fixed_random')
def test_puts_the_first_daily_slot_tomorrow_at_the_earliest_morning_time():
    assert next_check_at('daily', None, _at(2026, 10, 5, 15)) == _at(2026, 10, 6, 4, 0)


@pytest.mark.usefixtures('fixed_random')
def test_puts_the_first_weekly_slot_seven_days_ahead():
    assert next_check_at('weekly', None, _at(2026, 10, 5, 15)) == _at(2026, 10, 12, 4, 0)


@pytest.mark.usefixtures('fixed_random')
def test_puts_the_first_monthly_slot_on_the_last_day_of_this_month():
    assert next_check_at('monthly', None, _at(2026, 2, 3)) == _at(2026, 2, 28, 4, 0)


@pytest.mark.usefixtures('fixed_random')
def test_moves_the_first_monthly_slot_to_next_month_when_this_months_has_passed():
    assert next_check_at('monthly', None, _at(2026, 2, 28, 12)) == _at(2026, 3, 31, 4, 0)


@pytest.mark.parametrize('_attempt', range(20))
def test_draws_first_slots_between_four_and_ten_utc(_attempt):
    slot = next_check_at('daily', None, _at(2026, 10, 5))

    assert slot is not None
    assert 4 <= slot.hour <= 9


def test_keeps_the_weekly_anchor_weekday_when_the_run_was_late():
    monday = _at(2026, 10, 5, 7)

    assert next_check_at('weekly', monday, _at(2026, 10, 7, 9)) == _at(2026, 10, 12, 7)


def test_skips_missed_daily_slots_without_drifting():
    anchor = _at(2026, 10, 1, 5, 30)

    assert next_check_at('daily', anchor, _at(2026, 10, 4, 12)) == _at(2026, 10, 5, 5, 30)


def test_advances_a_slot_that_is_exactly_now_to_the_next_one():
    anchor = _at(2026, 10, 5, 5)

    assert next_check_at('daily', anchor, anchor) == _at(2026, 10, 6, 5)


def test_moves_a_monthly_slot_to_the_last_day_of_the_next_month():
    assert next_check_at('monthly', _at(2026, 1, 31, 4), _at(2026, 1, 31, 5)) == _at(2026, 2, 28, 4)


def test_keeps_the_last_day_in_a_leap_year_february():
    assert next_check_at('monthly', _at(2028, 1, 31, 4), _at(2028, 1, 31, 5)) == _at(2028, 2, 29, 4)


def test_reads_an_anchor_on_the_first_as_the_day_after_the_last_day():
    assert next_check_at('monthly', _at(2026, 3, 1, 4), _at(2026, 3, 1, 5)) == _at(2026, 4, 1, 4)


def test_reads_an_anchor_on_the_day_before_the_last_as_one_day_early():
    assert next_check_at('monthly', _at(2026, 3, 30, 4), _at(2026, 3, 30, 5)) == _at(2026, 4, 29, 4)


def test_moves_a_december_monthly_slot_into_january():
    assert next_check_at('monthly', _at(2026, 12, 31, 4), _at(2026, 12, 31, 5)) == _at(2027, 1, 31, 4)


def test_formats_with_microseconds_and_a_z_suffix():
    assert format_timestamp(_at(2026, 10, 5)) == '2026-10-05T06:00:00.000000Z'


def test_parses_a_formatted_timestamp_back():
    assert parse_timestamp('2026-10-05T06:00:00.000000Z') == _at(2026, 10, 5)


@pytest.mark.parametrize('text', ['yesterday', '2026-10-05T06:00:00'])
def test_rejects_text_that_is_not_a_utc_timestamp(text):
    assert parse_timestamp(text) is None
