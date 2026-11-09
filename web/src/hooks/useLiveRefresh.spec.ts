import {
  act, renderHook
} from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import {
  emitLive, liveSubscriberCount, reconnectLive, resetLiveEvents
} from '../test/liveEventsMock';
import { deploymentChannel } from '../infrastructure/liveEvents';
import { useLiveRefresh } from './useLiveRefresh';

vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

const RUNS = deploymentChannel('runs');

afterEach(() => {
  resetLiveEvents();
});

function renderRefresh(read: () => Promise<unknown>, active = true) {
  return renderHook(({ on }) => useLiveRefresh(on ? RUNS : null, read, (event) => event.type === 'wanted'), { initialProps: { on: active } });
}

describe('useLiveRefresh', () => {
  it('reads once when the subscription becomes active and again after a reconnect', async () => {
    const read = vi.fn(() => Promise.resolve());
    renderRefresh(read);
    await act(async () => {
      await Promise.resolve();
    });
    await reconnectLive('runs');

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads after an event it wants and not after others', async () => {
    const read = vi.fn(() => Promise.resolve());
    renderRefresh(read);
    await act(async () => {
      await Promise.resolve();
    });
    await emitLive('runs', { type: 'other' });
    await emitLive('runs', { type: 'wanted' });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('runs one read at a time and one more after a burst of events during it', async () => {
    const settle: { current: () => void } = { current: () => undefined };
    const read = vi.fn(() => new Promise<void>((resolve) => {
      settle.current = resolve;
    }));
    renderRefresh(read);
    await act(async () => {
      await Promise.resolve();
    });
    await emitLive('runs', { type: 'wanted' });
    await emitLive('runs', { type: 'wanted' });
    await emitLive('runs', { type: 'wanted' });
    const duringFirst = read.mock.calls.length;
    await act(async () => {
      settle.current();
      await Promise.resolve();
    });

    expect([duringFirst, read.mock.calls.length]).toStrictEqual([1, 2]);
  });

  it('keeps listening after a read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const read = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(undefined);
    renderRefresh(read);
    await act(async () => {
      await Promise.resolve();
    });
    await emitLive('runs', { type: 'wanted' });

    expect([read.mock.calls.length, error.mock.calls.length]).toStrictEqual([2, 1]);
  });

  it('subscribes to nothing and reads nothing without a channel, and stops listening when it loses it', async () => {
    const read = vi.fn(() => Promise.resolve());
    const { rerender } = renderRefresh(read, false);
    const idle = [liveSubscriberCount('runs'), read.mock.calls.length];
    rerender({ on: true });
    const listening = liveSubscriberCount('runs');
    rerender({ on: false });

    expect([idle, listening, liveSubscriberCount('runs')]).toStrictEqual([[0, 0], 1, 0]);
  });
});
