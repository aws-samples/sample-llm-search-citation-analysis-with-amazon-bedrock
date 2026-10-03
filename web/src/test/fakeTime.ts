import {
  afterEach, beforeEach, vi
} from 'vitest';
import { act } from '@testing-library/react';

/**
 * Lets `ms` of fake time pass inside `act`, so timers that fire and the
 * React updates they cause have settled when it resolves. Requires
 * `vi.useFakeTimers()`.
 */
export async function advanceFakeTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Registers hooks that switch the enclosing suite to fake timers before each test and back after it. */
export function runEachTestWithFakeTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
