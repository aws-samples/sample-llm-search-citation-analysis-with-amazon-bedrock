import {
  useEffect, useRef
} from 'react';
import {
  subscribeLive, type LiveChannel, type LiveEvent
} from '../infrastructure/liveEvents';

export interface LiveChannelHandlers {
  /** An event on the channel: what changed, by id; read the state it names if it is the one on screen. */
  readonly onEvent: (event: LiveEvent) => void;
  /**
   * The subscription is active: once after subscribing and again after every reconnect. Read the state once here,
   * so anything that changed while the view was not listening is caught up.
   */
  readonly onConnected: () => void;
}

/**
 * Listens to a live events channel while `channel` is not `null` (TENETS.md tenet 8). Pass `null` while there is
 * nothing to watch (no job running), so an idle view holds no subscription. The handlers may change on every
 * render; the subscription follows only the channel.
 */
export function useLiveChannel(channel: LiveChannel | null, handlers: LiveChannelHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const watched = useRef(channel);
  watched.current = channel;
  const key = channel === null ? null : `${channel.scope}/${channel.topic}`;

  useEffect(() => {
    const current = watched.current;
    if (key === null || current === null) return undefined;
    return subscribeLive(current, {
      onEvent: (event) => latest.current.onEvent(event),
      onConnected: () => latest.current.onConnected(),
    });
  }, [key]);
}
