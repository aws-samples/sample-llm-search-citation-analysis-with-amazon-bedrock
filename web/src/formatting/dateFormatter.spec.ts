import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  formatDate,
  formatDateOnly,
  formatTime,
  calculateDuration,
  formatApproximateDuration,
  formatRelativeTime
} from './dateFormatter';

describe('formatDate', () => {
  it('returns "N/A" when input is null', () => {
    expect(formatDate(null)).toBe('N/A');
  });

  it('returns "N/A" when input is undefined', () => {
    expect(formatDate(undefined)).toBe('N/A');
  });

  it('returns "N/A" when input is empty string', () => {
    expect(formatDate('')).toBe('N/A');
  });

  it('returns "Invalid date" when input is not a valid date string', () => {
    expect(formatDate('not-a-date')).toBe('Invalid date');
  });

  it('returns formatted date string when input is valid ISO date', () => {
    const result = formatDate('2026-01-23T10:30:00Z');

    // toLocaleString output varies by environment, so check it's not an error value
    expect(result).not.toBe('N/A');
    expect(result).not.toBe('Invalid date');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatTime', () => {
  it('returns "N/A" when input is null', () => {
    expect(formatTime(null)).toBe('N/A');
  });

  it('returns "N/A" when input is undefined', () => {
    expect(formatTime(undefined)).toBe('N/A');
  });

  it('returns "Invalid time" when input is not a valid date string', () => {
    expect(formatTime('invalid')).toBe('Invalid time');
  });

  it('returns formatted time string when input is valid ISO date', () => {
    const result = formatTime('2026-01-23T10:30:00Z');

    expect(result).not.toBe('N/A');
    expect(result).not.toBe('Invalid time');
  });
});

describe('calculateDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-23T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when startDate is null', () => {
    expect(calculateDuration(null)).toBeNull();
  });

  it('returns null when startDate is undefined', () => {
    expect(calculateDuration(undefined)).toBeNull();
  });

  it('returns null when startDate is empty string', () => {
    expect(calculateDuration('')).toBeNull();
  });

  it('returns null when startDate is invalid', () => {
    expect(calculateDuration('not-a-date')).toBeNull();
  });

  it('returns null when stopDate is invalid', () => {
    expect(calculateDuration('2026-01-23T10:00:00Z', 'invalid')).toBeNull();
  });

  it('returns seconds format when duration is under 1 minute', () => {
    const result = calculateDuration('2026-01-23T11:59:30Z', '2026-01-23T12:00:00Z');

    expect(result).toBe('30s');
  });

  it('returns minutes and seconds format when duration is under 1 hour', () => {
    const result = calculateDuration('2026-01-23T11:45:30Z', '2026-01-23T12:00:00Z');

    expect(result).toBe('14m 30s');
  });

  it('returns hours, minutes and seconds format when duration is 1 hour or more', () => {
    const result = calculateDuration('2026-01-23T10:30:15Z', '2026-01-23T12:00:00Z');

    expect(result).toBe('1h 29m 45s');
  });

  it('calculates duration to current time when stopDate is null', () => {
    const result = calculateDuration('2026-01-23T11:59:00Z', null);

    expect(result).toBe('1m 0s');
  });

  it('calculates duration to current time when stopDate is undefined', () => {
    const result = calculateDuration('2026-01-23T11:59:00Z');

    expect(result).toBe('1m 0s');
  });

  it('returns 0s when start and stop are the same time', () => {
    const result = calculateDuration('2026-01-23T12:00:00Z', '2026-01-23T12:00:00Z');

    expect(result).toBe('0s');
  });
});

describe('formatDateOnly', () => {
  it('returns the locale date without a time component', () => {
    const input = '2026-08-19T15:30:00Z';

    expect(formatDateOnly(input)).toBe(new Date(input).toLocaleDateString());
  });

  it('returns N/A when the date is null or undefined', () => {
    expect(formatDateOnly(null)).toBe('N/A');
    expect(formatDateOnly(undefined)).toBe('N/A');
  });

  it('returns Invalid date for an unparseable string', () => {
    expect(formatDateOnly('not-a-date')).toBe('Invalid date');
  });
});

describe('formatApproximateDuration', () => {
  it('returns the stranded run duration in days when given its raw seconds', () => {
    expect(formatApproximateDuration(4434821)).toBe('51 days');
  });

  it('returns hours when the duration is under a day', () => {
    expect(formatApproximateDuration(7200)).toBe('2 hours');
  });

  it('returns minutes when the duration is under an hour', () => {
    expect(formatApproximateDuration(300)).toBe('5 minutes');
  });

  it('returns seconds when the duration is under a minute', () => {
    expect(formatApproximateDuration(45)).toBe('45 seconds');
  });

  it('returns "0 seconds" when the duration is zero', () => {
    expect(formatApproximateDuration(0)).toBe('0 seconds');
  });

  it('uses the singular unit when the count is exactly one', () => {
    expect(formatApproximateDuration(86400)).toBe('1 day');
  });

  it('truncates rather than rounds up to the next unit', () => {
    expect(formatApproximateDuration(172799)).toBe('1 day');
  });

  it('returns "an unknown time" when the duration is negative', () => {
    expect(formatApproximateDuration(-5)).toBe('an unknown time');
  });

  it('returns "an unknown time" when the duration is NaN', () => {
    expect(formatApproximateDuration(Number.NaN)).toBe('an unknown time');
  });

  it('returns "an unknown time" when the duration is Infinity', () => {
    expect(formatApproximateDuration(Number.POSITIVE_INFINITY)).toBe('an unknown time');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-23T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "N/A" when input is null', () => {
    expect(formatRelativeTime(null)).toBe('N/A');
  });

  it('returns "N/A" when input is undefined', () => {
    expect(formatRelativeTime(undefined)).toBe('N/A');
  });

  it('returns "Invalid date" when input is not a valid date string', () => {
    expect(formatRelativeTime('not-a-date')).toBe('Invalid date');
  });

  it('returns "2 hours ago" for a timestamp two hours in the past', () => {
    expect(formatRelativeTime('2026-01-23T10:00:00Z')).toBe('2 hours ago');
  });

  it('returns days ago for a timestamp several days in the past', () => {
    expect(formatRelativeTime('2026-01-20T12:00:00Z')).toBe('3 days ago');
  });

  it('returns "just now" for a timestamp seconds in the past', () => {
    expect(formatRelativeTime('2026-01-23T11:59:50Z')).toBe('just now');
  });

  it('returns "just now" for a timestamp in the future', () => {
    expect(formatRelativeTime('2026-01-23T13:00:00Z')).toBe('just now');
  });
});
