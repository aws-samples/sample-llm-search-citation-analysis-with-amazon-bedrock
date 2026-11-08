import {
  useEffect, useState
} from 'react';
import {
  browserNotificationPermission, requestBrowserNotifications, type BrowserNotificationPermission
} from '../../hooks/exportNotifications';
import { useExports } from '../../hooks/useExports';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { LoadMoreButton } from '../ui/LoadMoreButton';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import { SkeletonTable } from '../ui/Skeleton';
import { ExportRow } from './ExportRow';

const HEADER_CELL = 'px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500';

/** Asks for browser notifications only from a click here; says what the browser decided. */
function BrowserNotificationsControl() {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(browserNotificationPermission);
  if (permission === 'unsupported') return null;
  if (permission === 'granted') return <p className="text-sm text-gray-500">Browser notifications are on: you are told when an export is ready while the dashboard is open.</p>;
  if (permission === 'denied') return <p className="text-sm text-gray-500">Browser notifications are blocked for this site in the browser settings.</p>;
  return (
    <div>
      <Button variant="secondary" size="sm" onClick={() => { void requestBrowserNotifications().then(setPermission); }}>
        Notify me in the browser
      </Button>
    </div>
  );
}

/**
 * The Exports page (`/exports`): the caller's exports, newest first, with status, rows, size,
 * created time, Download (a fresh link on each click), Cancel or Delete. Opening it marks every
 * finished export seen, which clears the header badge.
 */
export function ExportsView() {
  const center = useExports();
  const unseen = center?.unseenCount ?? 0;
  const markAllSeen = center?.markAllSeen;

  useEffect(() => {
    if (unseen > 0) markAllSeen?.();
  }, [unseen, markAllSeen]);

  if (center === null) return null;
  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Exports"
        description="Every Export all you started, from any view. Each runs in the background until the whole file is written; files are kept for 7 days."
      >
        <BrowserNotificationsControl />
      </PageHeaderCard>
      <ErrorAlert message={center.error} />
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        {center.loading && center.exports.length === 0 && <SkeletonTable rows={3} columns={6} />}
        {!center.loading && center.exports.length === 0 && (
          <p className="px-6 py-8 text-sm text-gray-500">No exports yet. Use Export all on any view to export its full data.</p>
        )}
        {center.exports.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={HEADER_CELL}>Export</th>
                <th scope="col" className={HEADER_CELL}>Format</th>
                <th scope="col" className={HEADER_CELL}>Status</th>
                <th scope="col" className={HEADER_CELL}>Rows</th>
                <th scope="col" className={HEADER_CELL}>Created</th>
                <th scope="col" className={HEADER_CELL}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {center.exports.map((summary) => (
                <ExportRow key={summary.export_id} summary={summary} onDownload={center.download} onRemove={center.remove} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      <LoadMoreButton
        onLoadMore={center.nextToken === null ? undefined : center.loadMore}
        loading={center.loadingMore}
        label="Load older exports"
      />
    </div>
  );
}
