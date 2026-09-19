import {
  afterEach, beforeEach, vi
} from 'vitest';

/**
 * Pins `Date.now()` to `isoInstant` for every test in the enclosing
 * `describe`, and restores real timers afterwards. For code that formats
 * or measures time relative to "now".
 */
export function freezeClockAt(isoInstant: string): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoInstant));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
