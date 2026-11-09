import {
  useCallback, useRef, useState
} from 'react';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import { isRecord } from '../types/domain/keywordDecoders';
import { useLiveChannel } from './useLiveChannel';

/**
 * A scoped answer served from a snapshot older than the scope (`stale: true`, 2.45.0) is shown as it is while a
 * rebuild runs; the view asks again when the deployment's `snapshots` channel says a build ended (TENETS.md
 * tenet 8), and once when that subscription becomes active (a build may have ended before it did), at most
 * `STALE_REFETCH_LIMIT` times, then keeps the figures it has.
 */
export const STALE_REFETCH_LIMIT = 18;

/** The channel a stale view listens to while it waits for a rebuild. */
export const SNAPSHOTS_CHANNEL = deploymentChannel('snapshots');

/** A scoped body whose snapshot predates the scope's latest change. */
export function isStaleScopedBody(value: unknown): boolean {
  return isRecord(value) && value.stale === true;
}

/**
 * Whether `event` says a scope snapshot build ended: an in-process build (`scope-snapshots.built`) or the
 * distributed build's state machine leaving `RUNNING`.
 */
export function isSnapshotBuildEnded(event: LiveEvent): boolean {
  if (event.type === 'scope-snapshots.built') return true;
  return event.type === 'execution.status' && eventField(event, 'status') !== 'RUNNING';
}

/**
 * One pending refetch: `schedule` replaces it and listens to the snapshots channel, a build that ended (or the
 * subscription becoming active) runs it once, `cancel` drops it. The subscription stays while refetches keep
 * answering stale, and ends once one does not schedule another; unmount ends it. The caller counts the rounds
 * and stops at `STALE_REFETCH_LIMIT`.
 */
export function useStaleRefetch() {
  const pending = useRef<(() => Promise<unknown>) | null>(null);
  const [listening, setListening] = useState(false);

  const fire = useCallback(async (): Promise<void> => {
    const refetch = pending.current;
    if (refetch === null) return;
    pending.current = null;
    await refetch();
    if (pending.current === null) setListening(false);
  }, []);

  useLiveChannel(listening ? SNAPSHOTS_CHANNEL : null, {
    onConnected: () => { void fire(); },
    onEvent: (event) => {
      if (isSnapshotBuildEnded(event)) void fire();
    },
  });

  const schedule = useCallback((refetch: () => Promise<unknown>): void => {
    pending.current = refetch;
    setListening(true);
  }, []);

  const cancel = useCallback((): void => {
    pending.current = null;
    setListening(false);
  }, []);

  return {
    schedule,
    cancel,
  };
}
