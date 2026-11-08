import { useState } from 'react';
import type { AlertItem } from '../../types';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import { AlertRow } from './AlertRow';
import { AllAlerts } from './AllAlerts';
import { useOpenAlerts } from '../../hooks/useAlerts';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { ErrorAlert } from '../ui/ErrorAlert';
import { RefreshTextButton } from '../ui/RefreshTextButton';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

function countLabel(count: number): string {
  return count === 1 ? '1 open alert' : `${count} open alerts`;
}

/** Open alerts the dashboard lists before "Show all". */
export const DASHBOARD_ALERT_PREVIEW = 5;

/** Newest run first; alerts of one run keep the order the API gave them. */
function newestFirst(items: readonly AlertItem[]): AlertItem[] {
  return [...items].sort((left, right) => right.run_timestamp.localeCompare(left.run_timestamp));
}

export function AlertsPanel() {
  const {
    items,
    count,
    loading,
    error,
    actionError,
    acknowledgingIds,
    refresh,
    acknowledge,
  } = useOpenAlerts();
  const { isAdmin } = useIsAdmin();
  const { catalog } = useMarketSelection();
  const [showAll, setShowAll] = useState(false);
  const sorted = newestFirst(items);
  const visible = sorted.slice(0, DASHBOARD_ALERT_PREVIEW);
  const hidden = Math.max(count, sorted.length) - visible.length;

  return (
    <section
      aria-labelledby="dashboard-alerts-heading"
      aria-busy={loading}
      className="mb-6 rounded-lg border border-gray-200 bg-white sm:mb-8"
    >
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 p-4 sm:p-5">
        <div>
          <h3 id="dashboard-alerts-heading" className="text-sm font-semibold text-gray-900">
            Alerts
          </h3>
          <p className="mt-1 text-xs text-gray-500">{countLabel(count)}</p>
        </div>
        <RefreshTextButton onRefresh={refresh} disabled={loading} />
      </div>

      <ErrorAlert message={error} spacingClassName="m-4 " />
      <ErrorAlert message={actionError} spacingClassName="m-4 " />

      {loading && items.length === 0 && (
        <SkeletonRegion label="Loading alerts" className="p-4 sm:p-5">
          <div className="flex h-5 items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-sm" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-2 flex h-5 items-center"><Skeleton className="h-3.5 w-40" /></div>
          <div className="mt-1 flex h-5 items-center"><Skeleton className="h-3.5 w-2/3" /></div>
        </SkeletonRegion>
      )}
      {showAll ? (
        <AllAlerts isAdmin={isAdmin} acknowledgingIds={acknowledgingIds} onAcknowledge={acknowledge} markets={catalog.markets} />
      ) : (
        <>
          {!loading && error === null && items.length === 0 && (
            <p className="p-6 text-center text-sm text-gray-500">No open alerts.</p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-gray-200">
              {visible.map((alertItem) => (
                <AlertRow
                  key={alertItem.id}
                  alertItem={alertItem}
                  isAdmin={isAdmin}
                  acknowledging={acknowledgingIds.includes(alertItem.id)}
                  onAcknowledge={acknowledge}
                  markets={catalog.markets}
                />
              ))}
            </ul>
          )}
        </>
      )}
      {(hidden > 0 || showAll) && (
        <div className="border-t border-gray-200 p-3 text-center">
          <button
            type="button"
            onClick={() => { setShowAll(!showAll); }}
            aria-expanded={showAll}
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            {showAll ? `Show the newest ${DASHBOARD_ALERT_PREVIEW}` : 'See all alerts'}
          </button>
        </div>
      )}
    </section>
  );
}
