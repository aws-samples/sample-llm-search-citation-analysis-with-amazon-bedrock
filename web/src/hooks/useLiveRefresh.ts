import {
  useCallback, useRef
} from 'react';
import type {
  LiveChannel, LiveEvent
} from '../infrastructure/liveEvents';
import { useLiveChannel } from './useLiveChannel';

function everyEvent(): boolean {
  return true;
}

/**
 * Runs `read` once each time the subscription to `channel` becomes active (the catch-up read on connect and on
 * every reconnect) and again after every event `matches` accepts (TENETS.md tenet 8). One read runs at a time:
 * events that arrive during a read cause one more read after it, however many they are, so a burst of events
 * (a run's keywords finishing) costs at most two reads. `channel` `null` subscribes to nothing and reads nothing.
 */
export function useLiveRefresh(
  channel: LiveChannel | null,
  read: () => Promise<unknown>,
  matches: (event: LiveEvent) => boolean = everyEvent
): void {
  const latestRead = useRef(read);
  latestRead.current = read;
  const flight = useRef({
    running: false,
    again: false 
  });

  const run = useCallback(async (): Promise<void> => {
    flight.current.again = false;
    try {
      await latestRead.current();
    } catch (failure) {
      console.error('[live events] A refresh failed:', failure);
    }
    if (flight.current.again) {
      await run();
      return;
    }
    flight.current.running = false;
  }, []);

  const trigger = useCallback(() => {
    if (flight.current.running) {
      flight.current.again = true;
      return;
    }
    flight.current.running = true;
    void run();
  }, [run]);

  useLiveChannel(channel, {
    onConnected: trigger,
    onEvent: (event) => {
      if (matches(event)) trigger();
    },
  });
}
