import {
  useCallback, useState
} from 'react';
import {
  fetchBacklinkSnapshots, setBacklinkSnapshotSchedule, startBacklinkSnapshots
} from '../api/seoBacklinks';
import { seoErrorMessage } from '../api/seo';
import type { BacklinkSnapshotsResponse } from '../types/api/seoBacklinks';
import {
  useSeoRequest, type SeoRequestState
} from './useSeoGeoRequest';

export interface BacklinkSnapshotsState extends SeoRequestState<BacklinkSnapshotsResponse> {
  /** The outcome of the last Admin action, to show next to the controls. */
  readonly notice: string | null;
  readonly busy: boolean;
  /** Admin: start one snapshot run of every tracked domain (paid). */
  readonly snapshotNow: () => Promise<void>;
  /** Admin: turn the weekly snapshot on or off. */
  readonly setSchedule: (enabled: boolean) => Promise<void>;
}

/**
 * The stored weekly snapshots of the owned and competitor domains (a free
 * read, fetched on mount and after the schedule changes) and the Admin
 * actions on them.
 */
export function useBacklinkSnapshots(active: boolean): BacklinkSnapshotsState {
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useSeoRequest(active, String(version), () => fetchBacklinkSnapshots());

  const act = useCallback(async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      setNotice(await action());
    } catch (failure) {
      setNotice(seoErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const snapshotNow = useCallback(() => act(async () => {
    const run = await startBacklinkSnapshots();
    return `Snapshot started for ${run.domains} domains. New points appear in a few minutes.`;
  }), [act]);

  const setSchedule = useCallback((enabled: boolean) => act(async () => {
    const answer = await setBacklinkSnapshotSchedule(enabled);
    setVersion((current) => current + 1);
    return answer.schedule_enabled ? 'Weekly snapshots are on (Mondays, 06:00 UTC).' : 'Weekly snapshots are off.';
  }), [act]);

  return {
    ...list,
    notice,
    busy,
    snapshotNow,
    setSchedule,
  };
}
