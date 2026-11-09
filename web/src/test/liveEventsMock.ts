/**
 * Replaces `infrastructure/liveEvents` in every dashboard spec (`setup.ts` mocks it and resets it after each test).
 *
 * A subscription is reported active at once (as the real client does once AppSync confirms it), so the view's
 * catch-up read runs; `emitLive` delivers an event and `reconnectLive` reports the subscription active again.
 */
import { act } from '@testing-library/react';
import type { LiveListener } from '../infrastructure/liveEvents/liveEventsClient';
import { createLiveWait } from '../infrastructure/liveEvents/liveWait';
import type {
  LiveChannel, LiveEvent
} from '../infrastructure/liveEvents/liveChannels';

export {
  deploymentChannel, eventField, userChannel, type LiveChannel, type LiveEvent
} from '../infrastructure/liveEvents/liveChannels';
export type { LiveListener } from '../infrastructure/liveEvents/liveEventsClient';

const listeners = new Map<string, Set<LiveListener>>();
const connections = { automatic: true };

export function subscribeLive(channel: LiveChannel, listener: LiveListener): () => void {
  const subscribed = listeners.get(channel.topic) ?? new Set<LiveListener>();
  listeners.set(channel.topic, subscribed);
  subscribed.add(listener);
  queueMicrotask(() => {
    if (connections.automatic && subscribed.has(listener)) listener.onConnected();
  });
  return () => {
    subscribed.delete(listener);
  };
}

/** The real `waitForLive`, over the fake subscriptions. */
export const waitForLive = createLiveWait(subscribeLive);

/** How many views listen to `topic` now. */
export function liveSubscriberCount(topic: LiveChannel['topic']): number {
  return listeners.get(topic)?.size ?? 0;
}

/** Delivers `event` to every listener of `topic`, inside `act`. */
export async function emitLive(topic: LiveChannel['topic'], event: LiveEvent): Promise<void> {
  await act(async () => {
    for (const listener of [...(listeners.get(topic) ?? [])]) listener.onEvent(event);
    await Promise.resolve();
  });
}

/** Reports every subscription to `topic` active again, as after a reconnect, inside `act`. */
export async function reconnectLive(topic: LiveChannel['topic']): Promise<void> {
  await act(async () => {
    for (const listener of [...(listeners.get(topic) ?? [])]) listener.onConnected();
    await Promise.resolve();
  });
}

/** New subscriptions stay inactive (no catch-up read) until `reconnectLive` reports them active. */
export function holdLiveConnections(): void {
  connections.automatic = false;
}

/** Forgets every listener and reports new subscriptions active again (between tests). */
export function resetLiveEvents(): void {
  listeners.clear();
  connections.automatic = true;
}
