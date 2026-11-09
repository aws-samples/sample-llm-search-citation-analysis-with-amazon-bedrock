/**
 * What a spec of a live-refreshed view checks after the view settles: how many requests the mocked
 * `authenticatedFetch` made and how many views still listen to a topic of the fake live events.
 */
import type {
  LiveChannel, LiveEvent
} from '../infrastructure/liveEvents/liveChannels';
import { mockAuthenticatedFetch } from './infrastructureMock';
import {
  emitLive, liveSubscriberCount
} from './liveEventsMock';

/** The scope snapshot build's event (`scope-snapshots.built`), which stale snapshot views read again on. */
export const SNAPSHOTS_BUILT_EVENT: LiveEvent = {
  type: 'scope-snapshots.built',
  status: 'built'
};

/** `[requests made, listeners of topic]`, compared as one pair. */
export function readsAndListeners(topic: LiveChannel['topic']): [number, number] {
  return [mockAuthenticatedFetch.mock.calls.length, liveSubscriberCount(topic)];
}

/** Delivers `event` to `topic` `times` times in a row, running `afterEach` (a timer flush) after each one. */
export async function emitLiveRepeatedly(
  topic: LiveChannel['topic'],
  event: LiveEvent,
  times: number,
  afterEach: () => Promise<unknown> = () => Promise.resolve()
): Promise<void> {
  await Array.from({ length: times }).reduce<Promise<void>>(async (previous) => {
    await previous;
    await emitLive(topic, event);
    await afterEach();
  }, Promise.resolve());
}
