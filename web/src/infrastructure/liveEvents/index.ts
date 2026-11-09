/**
 * The dashboard's live events (AWS AppSync Events, TENETS.md tenet 8): one shared client, subscribed through
 * `useLiveChannel` (`web/src/hooks/useLiveChannel.ts`).
 */
import {
  getAuthToken, getUserSub 
} from '../auth';
import { loadedLiveEvents } from '../config/runtimeConfig';
import {
  LiveEventsClient, type LiveListener, type LiveSocket
} from './liveEventsClient';
import type { LiveChannel } from './liveChannels';
import { createLiveWait } from './liveWait';

export {
  deploymentChannel, eventField, userChannel, type LiveChannel, type LiveEvent
} from './liveChannels';
export type { LiveListener } from './liveEventsClient';

function onWake(retry: () => void): () => void {
  const visible = (): void => {
    if (document.visibilityState === 'visible') retry();
  };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', retry);
    document.removeEventListener('visibilitychange', visible);
  };
}

const client = new LiveEventsClient({
  endpoints: loadedLiveEvents,
  idToken: getAuthToken,
  userSub: getUserSub,
  openSocket: (url, protocols): LiveSocket => new WebSocket(url, protocols),
  onWake,
  random: Math.random,
});

/** Listen to `channel` with `listener` until the returned function is called. */
export function subscribeLive(channel: LiveChannel, listener: LiveListener): () => void {
  return client.subscribe(channel, listener);
}

/** Waits for a state to settle on live events (`liveWait.ts`). */
export const waitForLive = createLiveWait(subscribeLive);
