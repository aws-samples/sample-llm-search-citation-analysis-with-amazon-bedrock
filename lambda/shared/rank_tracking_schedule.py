"""When a scheduled rank tracker runs next.

- ``manual`` trackers never run on their own (``None``).
- The first slot of a scheduled tracker is at a random time between 04:00 and 09:59 UTC (spreading the load
  over the morning): tomorrow for ``daily``, in seven days for ``weekly``, and the last day of this month for
  ``monthly`` (next month's when that time has passed).
- After that every slot is computed from the previous one (the anchor), never from when the run actually
  started, so a late run does not shift the schedule: a weekly tracker due on Monday that ran on Wednesday is
  next due on the following Monday. Monthly slots stay on the last day of the month at the anchor's time; an
  anchor on the 1st means "the day after the last day" and an anchor on the day before the last means "one day
  before the last", so that offset is kept without storing it.

Timestamps are UTC ISO-8601 with microseconds and a ``Z`` suffix, the project's wire format, so they sort as text.
"""

from __future__ import annotations

import calendar
import random
from datetime import UTC, datetime, timedelta

__all__ = [
    'SCHEDULES',
    'format_timestamp',
    'next_check_at',
    'parse_timestamp',
]

SCHEDULES = ('daily', 'weekly', 'monthly', 'manual')
_INTERVALS = {'daily': timedelta(days=1), 'weekly': timedelta(days=7)}
FIRST_SLOT_HOURS = (4, 9)
"""The first slot's random hour range (inclusive), UTC."""

_rng = random.SystemRandom()
"""Spreads first slots over the morning; not used for anything secret."""


def format_timestamp(moment: datetime) -> str:
    """``moment`` as ``YYYY-MM-DDTHH:MM:SS.ffffffZ`` (UTC)."""
    return moment.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def parse_timestamp(text: str) -> datetime | None:
    """A ``Z`` timestamp as an aware UTC datetime; ``None`` when it does not parse."""
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(UTC) if moment.tzinfo else None


def _last_day(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _random_time(day: datetime) -> datetime:
    hour = _rng.randint(*FIRST_SLOT_HOURS)
    return day.replace(hour=hour, minute=_rng.randint(0, 59), second=0, microsecond=0)


def _month_shift(anchor: datetime) -> int:
    """-1, 0 or +1 days from the last day of the month, read back from a monthly anchor."""
    if anchor.day == 1:
        return 1
    if anchor.day == _last_day(anchor.year, anchor.month) - 1:
        return -1
    return 0


def _month_slot(year: int, month: int, shift: int, at: datetime) -> datetime:
    """The last day of ``year-month`` plus ``shift`` days, at ``at``'s time of day."""
    last = datetime(year, month, _last_day(year, month), at.hour, at.minute, at.second, tzinfo=UTC)
    return last + timedelta(days=shift)


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def _monthly_after(anchor: datetime, now: datetime) -> datetime:
    """The first monthly slot after both ``anchor`` and ``now``."""
    shift = _month_shift(anchor)
    # The anchor of a +1 shift sits in the month after the one it belongs to.
    home = anchor - timedelta(days=1) if shift == 1 else anchor
    year, month = home.year, home.month
    floor = max(anchor, now)
    while True:
        slot = _month_slot(year, month, shift, anchor)
        if slot > floor:
            return slot
        year, month = _next_month(year, month)


def _first_slot(schedule: str, now: datetime) -> datetime:
    if schedule == 'monthly':
        slot = _random_time(_month_slot(now.year, now.month, 0, now))
        if slot > now:
            return slot
        year, month = _next_month(now.year, now.month)
        return _random_time(_month_slot(year, month, 0, now))
    return _random_time(now + _INTERVALS[schedule])


def next_check_at(schedule: str, anchor: datetime | None, now: datetime) -> datetime | None:
    """The next slot of ``schedule`` after ``now``, from the previous slot ``anchor`` when there is one."""
    if schedule not in _INTERVALS and schedule != 'monthly':
        return None
    if anchor is None:
        return _first_slot(schedule, now)
    if schedule == 'monthly':
        return _monthly_after(anchor, now)
    interval = _INTERVALS[schedule]
    elapsed = max(timedelta(0), now - anchor)
    return anchor + (elapsed // interval + 1) * interval
