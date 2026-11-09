import {
  describe, expect, it, vi
} from 'vitest';
import {
  emitLive, liveSubscriberCount, waitForLive
} from '../../test/liveEventsMock';
import { runEachTestWithFakeTimers } from '../../test/fakeTime';
import { deploymentChannel } from './liveChannels';
import type { LiveReadOutcome } from './liveWait';

runEachTestWithFakeTimers();

class TimedOut extends Error {
  constructor() {
    super('timed out');
    this.name = 'TimedOut';
  }
}

const SETTLED: LiveReadOutcome<string> = {
  settled: true,
  value: 'done' 
};
const PENDING: LiveReadOutcome<string> = { settled: false };

/** A read that finds the state pending once and settled from then on. */
function mockPendingThenSettled() {
  return vi.fn<() => Promise<LiveReadOutcome<string>>>().mockResolvedValueOnce(PENDING).mockResolvedValue(SETTLED);
}

function waitWith(read: () => Promise<LiveReadOutcome<string>>, signal?: AbortSignal, abortedValue?: () => string) {
  return waitForLive<string>({
    channel: deploymentChannel('view-jobs'),
    matches: (event) => event.type === 'wanted',
    read,
    limitMs: 60_000,
    timedOut: () => new TimedOut(),
    signal,
    abortedValue,
  });
}

describe('waitForLive', () => {
  it('resolves with the catch-up read when the state already settled, and stops listening', async () => {
    await expect(waitWith(() => Promise.resolve(SETTLED))).resolves.toBe('done');
    expect(liveSubscriberCount('view-jobs')).toBe(0);
  });

  it('reads again only on a wanted event', async () => {
    const read = mockPendingThenSettled();
    const waiting = waitWith(read);
    await vi.advanceTimersByTimeAsync(0);
    await emitLive('view-jobs', { type: 'other' });
    const beforeWanted = read.mock.calls.length;
    await emitLive('view-jobs', { type: 'wanted' });

    await expect(waiting).resolves.toBe('done');
    expect([beforeWanted, read.mock.calls.length]).toStrictEqual([1, 2]);
  });

  it('rejects with the read’s error', async () => {
    await expect(waitWith(() => Promise.reject(new TypeError('gone')))).rejects.toThrow('gone');
  });

  it('rejects with the timeout error when the read at the limit still finds it pending', async () => {
    const read = vi.fn(() => Promise.resolve(PENDING));
    const waiting = expect(waitWith(read)).rejects.toBeInstanceOf(TimedOut);
    await vi.advanceTimersByTimeAsync(60_000);
    await waiting;
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('resolves with the read at the limit when the state settled without an event', async () => {
    const waiting = waitWith(mockPendingThenSettled());
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(waiting).resolves.toBe('done');
  });

  it('rejects with the signal’s reason on an abort, and stops listening', async () => {
    const controller = new AbortController();
    const waiting = expect(waitWith(() => Promise.resolve(PENDING), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await waiting;
    expect(liveSubscriberCount('view-jobs')).toBe(0);
  });

  it('resolves with the aborted value on an abort when it has one', async () => {
    const controller = new AbortController();
    const waiting = waitWith(() => Promise.resolve(PENDING), controller.signal, () => 'aborted');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(waiting).resolves.toBe('aborted');
  });

  it('settles an already aborted wait at once', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitWith(() => Promise.resolve(PENDING), controller.signal, () => 'aborted')).resolves.toBe('aborted');
  });
});
