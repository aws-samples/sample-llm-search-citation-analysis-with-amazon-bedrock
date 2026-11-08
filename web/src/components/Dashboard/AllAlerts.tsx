import {
  useId, useState
} from 'react';
import type {
  AlertStatusFilter, Market
} from '../../types';
import { useAlertList } from '../../hooks/useAlertList';
import { ErrorAlert } from '../ui/ErrorAlert';
import { ExportAllButton } from '../ui/ExportAllButton';
import { LoadMoreButton } from '../ui/LoadMoreButton';
import { AlertRow } from './AlertRow';

const COUNT = new Intl.NumberFormat('en');

const STATUS_OPTIONS: ReadonlyArray<{
  readonly value: AlertStatusFilter;
  readonly label: string;
}> = [
  {
    value: 'open',
    label: 'Open',
  },
  {
    value: 'acknowledged',
    label: 'Acknowledged',
  },
  {
    value: 'all',
    label: 'All',
  },
];

interface AllAlertsProps {
  readonly isAdmin: boolean;
  readonly acknowledgingIds: readonly string[];
  /** Acknowledges the alert; resolves truthy once the API did. */
  readonly onAcknowledge: (id: string) => Promise<unknown>;
  readonly markets: readonly Market[];
}

/** "Showing 100 of 340 alerts" while pages are left. */
function shownOfTotal(shown: number, total: number | null): string | null {
  if (total === null || total <= shown) return null;
  return `Showing ${COUNT.format(shown)} of ${COUNT.format(total)} alerts`;
}

/**
 * The full alerts list of the dashboard (2.45.0 wave 5): every alert of the chosen status, a page
 * at a time, with Export all of that status.
 */
export function AllAlerts({
  isAdmin, acknowledgingIds, onAcknowledge, markets
}: AllAlertsProps) {
  const [status, setStatus] = useState<AlertStatusFilter>('open');
  const list = useAlertList(status);
  const statusId = useId();
  const acknowledge = async (id: string) => {
    const outcome = await onAcknowledge(id);
    if (typeof outcome === 'object' && outcome !== null && 'success' in outcome && outcome.success === true) list.markAcknowledged(id);
    return outcome;
  };
  const shown = shownOfTotal(list.items.length, list.total);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 p-4 sm:p-5">
        <div>
          <label htmlFor={statusId} className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            id={statusId}
            value={status}
            onChange={(event) => setStatus(STATUS_OPTIONS.find((option) => option.value === event.target.value)?.value ?? 'open')}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <ExportAllButton view="alerts" params={{ status }} />
      </div>
      <ErrorAlert message={list.error} spacingClassName="m-4 " />
      {list.loading && <p className="p-6 text-center text-sm text-gray-500">Loading alerts…</p>}
      {!list.loading && list.error === null && list.items.length === 0 && (
        <p className="p-6 text-center text-sm text-gray-500">No alerts with this status.</p>
      )}
      {list.items.length > 0 && (
        <ul className="divide-y divide-gray-200" aria-label="Every alert">
          {list.items.map((alertItem) => (
            <AlertRow
              key={alertItem.id}
              alertItem={alertItem}
              isAdmin={isAdmin}
              acknowledging={acknowledgingIds.includes(alertItem.id)}
              onAcknowledge={acknowledge}
              markets={markets}
            />
          ))}
        </ul>
      )}
      <div className="p-3">
        {shown !== null && <p className="mb-2 text-center text-sm text-gray-500">{shown}</p>}
        <LoadMoreButton onLoadMore={list.loadMore} loading={list.loadingMore} label="Load more alerts" />
      </div>
    </div>
  );
}
