import {
  useCallback, useState
} from 'react';
import {
  fetchBacklinkSnapshots, startBacklinkSnapshots
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
}

/**
 * The stored snapshots of the owned and competitor domains (a free read,
 * fetched on mount) and the Admin "snapshot now". A weekly run is a Schedule
 * (Operations > Schedule).
 */
export function useBacklinkSnapshots(active: boolean): BacklinkSnapshotsState {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useSeoRequest(active, 'snapshots', () => fetchBacklinkSnapshots());

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


  return {
    ...list,
    notice,
    busy,
    snapshotNow,
  };
}
