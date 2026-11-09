import {
  describe, expect, it
} from 'vitest';
import {
  describeNextRun, formatRunTime, nextRunAt
} from './scheduleNextRun';
import type { ScheduleTiming } from './scheduleFormModel';

/** Monday 2 November 2026, 08:00 UTC. */
const NOW = new Date('2026-11-02T08:00:00Z');

const DAILY_UTC: ScheduleTiming = {
  frequency: 'daily',
  time: '09:00',
  timezone: 'UTC',
  day_of_week: 'MON',
  day_of_month: 1,
};

describe('nextRunAt', () => {
  it.each<[string, Partial<ScheduleTiming>, string]>([
    ['later today for a daily schedule', {}, '2026-11-02T09:00:00.000Z'],
    ['tomorrow once today\'s time has passed', { time: '07:30' }, '2026-11-03T07:30:00.000Z'],
    ['on the next matching weekday', {
      frequency: 'weekly',
      day_of_week: 'FRI'
    }, '2026-11-06T09:00:00.000Z'],
    ['on the day of next month', {
      frequency: 'monthly',
      day_of_month: '1'
    }, '2026-12-01T09:00:00.000Z'],
    ['in the schedule\'s own zone', {
      timezone: 'Europe/Madrid',
      time: '08:30'
    }, '2026-11-03T07:30:00.000Z'],
    ['across a zone behind UTC', {
      timezone: 'America/Santiago',
      time: '06:00'
    }, '2026-11-02T09:00:00.000Z'],
  ])('fires %s', (_case, overrides, expected) => {
    expect(nextRunAt({
      ...DAILY_UTC,
      ...overrides
    }, NOW)?.toISOString()).toBe(expected);
  });

  it.each([
    ['an unreadable time', { time: '9' }],
    ['an unknown zone', { timezone: 'Mars/Olympus_Mons' }],
  ])('gives up on %s', (_case, overrides) => {
    expect(nextRunAt({
      ...DAILY_UTC,
      ...overrides
    }, NOW)).toBeNull();
  });
});

describe('describeNextRun', () => {
  it('names the next run in the schedule\'s zone', () => {
    expect(describeNextRun(DAILY_UTC, NOW)).toBe(`Next run: ${formatRunTime(new Date('2026-11-02T09:00:00Z'), 'UTC')}`);
  });

  it('says nothing when the next run cannot be worked out', () => {
    expect(describeNextRun({
      ...DAILY_UTC,
      timezone: 'Nowhere/At_All'
    }, NOW)).toBeNull();
  });
});

describe('formatRunTime', () => {
  it('says unknown for a missing or invalid time', () => {
    expect([formatRunTime(null), formatRunTime(new Date('nope'))]).toStrictEqual(['unknown', 'unknown']);
  });
});
