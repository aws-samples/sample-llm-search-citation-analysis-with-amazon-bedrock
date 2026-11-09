import {
  act, renderHook
} from '@testing-library/react';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  emitLive, liveSubscriberCount, reconnectLive
} from '../test/liveEventsMock';
import { deploymentChannel } from '../infrastructure/liveEvents';
import { useLiveRefresh } from './useLiveRefresh';

const RUNS = deploymentChannel('runs');

const WANTED = { type: 'wanted' };

function renderRefresh(read: () => Promise<unknown>, active = true) {
  return renderHook(({ on }) => useLiveRefresh(on ? RUNS : null, read, (event) => event.type === 'wanted'), { initialProps: { on: active } });
}

/** Renders the hook listening to the runs channel and lets the subscription report itself active (the first read). */
async function renderConnectedRefresh<Read extends () => Promise<unknown>>(read: Read): Promise<Read> {
  renderRefresh(read);
  await act(async () => {
    await Promise.resolve();
  });
  return read;
}

describe('useLiveRefresh', () => {
  it('reads once when the subscription becomes active and again after a reconnect', async () => {
    const read = await renderConnectedRefresh(vi.fn(() => Promise.resolve()));
    await reconnectLive('runs');

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads after an event it wants and not after others', async () => {
    const read = await renderConnectedRefresh(vi.fn(() => Promise.resolve()));
    await emitLive('runs', { type: 'other' });
    await emitLive('runs', WANTED);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('runs one read at a time and one more after a burst of events during it', async () => {
    const settle: { current: () => void } = { current: () => undefined };
    const read = vi.fn(() => new Promise<void>((resolve) => {
      settle.current = resolve;
    }));
    await renderConnectedRefresh(read);
    await [1, 2, 3].reduce(async (previous) => {
      await previous;
      await emitLive('runs', WANTED);
    }, Promise.resolve());
    const duringFirst = read.mock.calls.length;
    await act(async () => {
      settle.current();
      await Promise.resolve();
    });

    expect({
      duringFirst,
      afterIt: read.mock.calls.length
    }).toStrictEqual({
      duringFirst: 1,
      afterIt: 2
    });
  });

  it('keeps listening after a read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const read = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(undefined);
    await renderConnectedRefresh(read);
    await emitLive('runs', WANTED);

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
