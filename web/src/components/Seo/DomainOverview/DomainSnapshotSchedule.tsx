import {
  useEffect, useState
} from 'react';
import { seoErrorMessage } from '../../../api/seo';
import {
  fetchDomainSnapshotSchedule, setDomainSnapshotSchedule
} from '../../../api/seoDomains';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/Modal';
import type { DomainSnapshotScheduleResponse } from '../../../types/api/seoDomains';

type State = { readonly kind: 'loading' | 'saving' } | {
  readonly kind: 'ready';
  readonly enabled: boolean;
} | {
  readonly kind: 'failed';
  readonly message: string;
};

/**
 * (Admin) The weekly sweep that snapshots every owned and competitor domain in
 * every Labs market. It is recurring paid work, so it stays off until an Admin
 * turns it on here, after a confirmation (the server enforces the same).
 */
export function DomainSnapshotSchedule() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const show = (response: DomainSnapshotScheduleResponse) => setState({
    kind: 'ready',
    enabled: response.schedule_enabled,
  });
  const fail = (failure: unknown) => setState({
    kind: 'failed',
    message: seoErrorMessage(failure),
  });
  useEffect(() => {
    const controller = new AbortController();
    fetchDomainSnapshotSchedule({ signal: controller.signal }).then(show, (failure: unknown) => {
      if (!controller.signal.aborted) fail(failure);
    });
    return () => controller.abort();
  }, []);
  const save = (enabled: boolean) => {
    setConfirming(false);
    setState({ kind: 'saving' });
    setDomainSnapshotSchedule(enabled).then(show, fail);
  };
  if (state.kind === 'failed') return <output className="text-sm text-red-700">{state.message}</output>;
  const enabled = state.kind === 'ready' && state.enabled;
  const busy = state.kind !== 'ready';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-gray-600">{enabled ? 'Weekly snapshot of your and your competitors\u2019 domains is on.' : 'Weekly snapshot is off.'}</span>
      {enabled
        ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => save(false)}>Turn weekly snapshot off</Button>
        : <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>Turn weekly snapshot on</Button>}
      <ConfirmModal
        title="Turn on weekly snapshots?"
        message="Every Monday this snapshots each of your and your competitors' domains in every market DataForSEO Labs serves: 2 paid DataForSEO calls per domain and market, at most 40 pairs. Continue?"
        confirmText="Turn on"
        isOpen={confirming}
        onConfirm={() => save(true)}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
