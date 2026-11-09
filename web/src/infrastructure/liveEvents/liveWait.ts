/**
 * Waiting for a state to settle on live events (TENETS.md tenet 8), for code that awaits one result rather than
 * rendering a hook: a view job's answer, a research job's end. The state is read once when the subscription
 * becomes active (it may have settled before) and after every reconnect, and again after every event that
 * concerns it; one read runs at a time, and events during a read cause one more read after it. Nothing is read
 * on a timer: the only timer is the limit, which reads once more before the wait gives up, so a wait whose events
 * never arrived (no connection) still ends with the state as it is.
 */
import { abortReason } from '../errors';
import type {
  LiveChannel, LiveEvent
} from './liveChannels';
import type { LiveListener } from './liveEventsClient';

/** What one read found: the settled value, or that the wait goes on. */
export type LiveReadOutcome<T> =
  | {
    readonly settled: true;
    readonly value: T 
  }
  | { readonly settled: false };

export interface LiveWait<T> {
  readonly channel: LiveChannel;
  /** Whether an event concerns the awaited state (read it again). */
  readonly matches: (event: LiveEvent) => boolean;
  /** One read; a settled outcome ends the wait with its value, a throw ends it with that error. */
  readonly read: () => Promise<LiveReadOutcome<T>>;
  readonly limitMs: number;
  /** The error the wait rejects with when `limitMs` passed unsettled. */
  readonly timedOut: () => unknown;
  readonly signal?: AbortSignal;
  /** The value an abort resolves with; without one, an abort rejects with the signal's reason. */
  readonly abortedValue?: () => T;
}

type Subscribe = (channel: LiveChannel, listener: LiveListener) => () => void;

interface Flight {
  running: boolean;
  again: boolean;
  done: boolean;
}

/** `waitForLive` over `subscribe` (the shared client, or a spec's fake). */
export function createLiveWait(subscribe: Subscribe) {
  return function waitForLive<T>(wait: LiveWait<T>): Promise<T> {
    const { signal } = wait;
    return new Promise<T>((resolve, reject) => {
      const flight: Flight = {
        running: false,
        again: false,
        done: false 
      };
      const finish = (settle: () => void): void => {
        if (flight.done) return;
        flight.done = true;
        clearTimeout(timer);
        release();
        signal?.removeEventListener('abort', onAbort);
        settle();
      };
      const onAbort = (): void => {
        if (signal === undefined) return;
        const { abortedValue } = wait;
        finish(() => (abortedValue === undefined ? reject(abortReason(signal)) : resolve(abortedValue())));
      };
      const attempt = async (): Promise<void> => {
        flight.again = false;
        try {
          const outcome = await wait.read();
          if (outcome.settled) finish(() => resolve(outcome.value));
        } catch (failure) {
          finish(() => reject(failure));
        }
        if (flight.again && !flight.done) {
          await attempt();
          return;
        }
        flight.running = false;
      };
      const trigger = (): void => {
        if (flight.done) return;
        if (flight.running) {
          flight.again = true;
          return;
        }
        flight.running = true;
        void attempt();
      };
      const lastRead = async (): Promise<void> => {
        try {
          const outcome = await wait.read();
          finish(() => (outcome.settled ? resolve(outcome.value) : reject(wait.timedOut())));
        } catch (failure) {
          finish(() => reject(failure));
        }
      };
      const timer = setTimeout(() => {
        if (!flight.done) void lastRead();
      }, wait.limitMs);
      const release = subscribe(wait.channel, {
        onConnected: trigger,
        onEvent: (event) => {
          if (wait.matches(event)) trigger();
        },
      });
      if (signal?.aborted === true) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
}
