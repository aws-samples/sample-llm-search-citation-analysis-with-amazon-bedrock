import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BacklinkSnapshotsState } from '../../../hooks/useBacklinkSnapshots';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ConfirmModal } from '../../ui/Modal';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import { AuthorityChart } from './BacklinksCharts';

/** "2 paid DataForSEO calls": one per tracked domain. */
function callCount(domains: number): string {
  return domains === 1 ? '1 paid DataForSEO call' : `${String(domains)} paid DataForSEO calls`;
}

function AdminControls({
  snapshots, domains
}: {
  readonly snapshots: BacklinkSnapshotsState;
  readonly domains: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const closeConfirm = () => setConfirming(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={snapshots.busy || domains === 0} onClick={() => setConfirming(true)}>Snapshot now</Button>
      <Link to="/schedule" className="text-sm text-blue-700 hover:underline">Schedule weekly snapshots</Link>
      {snapshots.notice !== null && <output className="text-sm text-gray-600">{snapshots.notice}</output>}
      <ConfirmModal
        isOpen={confirming}
        onClose={closeConfirm}
        onConfirm={() => void snapshots.snapshotNow()}
        title="Snapshot now?"
        message={`This starts ${callCount(domains)}, one per domain. Continue?`}
        confirmText="Snapshot"
      />
    </div>
  );
}

/** "Authority over time": your domains against your competitors' from the stored weekly snapshots (free to read). */
export function BacklinkSnapshotsPanel({
  snapshots, isAdmin
}: {
  readonly snapshots: BacklinkSnapshotsState;
  readonly isAdmin: boolean;
}) {
  const data = snapshots.data;
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Authority over time</h3>
        <p className="text-xs text-gray-500">
          DataForSEO rank (0-100) of your domains and your competitors&apos;, with subdomains, from weekly snapshots.
          {' Weekly runs are a Schedule (Operations > Schedule).'}
        </p>
      </div>
      {snapshots.loading && (
        <SkeletonRegion label="Loading snapshots"><SkeletonTable rows={4} columns={1} rowClassName="h-12" /></SkeletonRegion>
      )}
      {snapshots.error !== null && <ErrorAlert message={snapshots.error} />}
      {data !== null && data.domains.length === 0 && (
        <p className="text-sm text-gray-600">Add your domains and competitor domains in Settings › Brand Tracking to compare them here.</p>
      )}
      {data !== null && data.domains.length > 0 && <AuthorityChart domains={data.domains} />}
      {isAdmin && data !== null && (
        <AdminControls snapshots={snapshots} domains={data.domains.length} />
      )}
    </section>
  );
}
