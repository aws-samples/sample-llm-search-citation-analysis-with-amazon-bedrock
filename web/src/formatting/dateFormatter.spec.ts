import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  formatDate, formatTime, calculateDuration 
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
