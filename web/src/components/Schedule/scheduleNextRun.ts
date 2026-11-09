import type { ScheduleTiming } from './scheduleFormModel';

/**
 * When a schedule fires next, worked out in the browser from its stored form,
 * so the form and the list can say "Next run: Mon 3 Nov, 09:00" without an
 * API call. EventBridge Scheduler is the source of truth; around a DST change
 * this can be an hour off, which is fine for a preview.
 */

const DAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/** Look this far ahead: a monthly schedule fires within 31 days. */
const SEARCH_DAYS = 62;
const MINUTE_MS = 60_000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** The wall clock of `instant` in `timeZone`; throws RangeError for an unknown zone. */
function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
}

function firesOn(timing: ScheduleTiming, wallDate: Date): boolean {
  if (timing.frequency === 'weekly') return wallDate.getUTCDay() === DAY_INDEX[timing.day_of_week];
  if (timing.frequency === 'monthly') return wallDate.getUTCDate() === Number(timing.day_of_month);
  return true;
}

function isKnownZone(timeZone: string): boolean {
  try {
    wallClock(new Date(0), timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The next time the schedule fires after `now`, or null when the time or zone cannot be read. */
export function nextRunAt(timing: ScheduleTiming, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timing.time);
  if (match === null || !isKnownZone(timing.timezone)) return null;
  const today = wallClock(now, timing.timezone);
  // Each candidate wall-clock time is held in a Date read with UTC getters.
  const candidates = Array.from({ length: SEARCH_DAYS + 1 }, (_, offset) => new Date(
    Date.UTC(today.year, today.month - 1, today.day + offset, Number(match[1]), Number(match[2]))
  ));
  const instantOf = (wall: Date) => new Date(wall.getTime() - zoneOffsetMs(wall, timing.timezone));
  const wall = candidates.find((candidate) => firesOn(timing, candidate) && instantOf(candidate).getTime() > now.getTime());
  return wall === undefined ? null : instantOf(wall);
}

/** "Mon, 9 Nov 2026, 04:30" in `timeZone` (the browser's zone when omitted), or "unknown" for an unreadable time. */
export function formatRunTime(when: Date | null, timeZone?: string): string {
  if (when === null || Number.isNaN(when.getTime())) return 'unknown';
  return when.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Next run: Mon, 3 Nov 2026, 09:00", in the schedule's own zone; null when it cannot be worked out. */
export function describeNextRun(timing: ScheduleTiming, now: Date = new Date()): string | null {
  const next = nextRunAt(timing, now);
  return next === null ? null : `Next run: ${formatRunTime(next, timing.timezone)}`;
}
