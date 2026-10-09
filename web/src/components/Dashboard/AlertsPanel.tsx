import {
  GLOBAL_MARKET_ID,
  type AlertItem, type AlertMetricValue, type AlertSeverity, type AlertType, type Market
} from '../../types';
import { MarketBadge } from '../Markets/MarketBadge';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import { formatDate } from '../../formatting/dateFormatter';
import { useOpenAlerts } from '../../hooks/useAlerts';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { ErrorAlert } from '../ui/ErrorAlert';
import { RefreshTextButton } from '../ui/RefreshTextButton';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  mention_rate_drop: 'Mention-rate drop',
  citation_rate_drop: 'Keyword-coverage drop (before 2.21)',
  position_loss: 'Position loss',
  new_competitor_top: 'New competitor in top results',
  keyword_lost_mention: 'Keyword lost mention',
  improvement_after_content_change: 'Improvement after content change',
};

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
};

const SEVERITY_CLASSES: Record<AlertSeverity, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

function countLabel(count: number): string {
  return count === 1 ? '1 open alert' : `${count} open alerts`;
}

function metricValueLabel(metricValue: AlertMetricValue): string {
  if (metricValue === null) return 'Not available';
  return String(metricValue);
}

function MetricChange({ alertItem }: { readonly alertItem: AlertItem }) {
  if (alertItem.previous === null && alertItem.current === null) return null;
  return (
    <p className="mt-2 text-xs text-gray-600" aria-label="Metric change">
      <span className="font-medium">Previous:</span> {metricValueLabel(alertItem.previous)}
      <span aria-hidden="true"> → </span>
      <span className="sr-only"> to </span>
      <span className="font-medium">Current:</span> {metricValueLabel(alertItem.current)}
    </p>
  );
}

interface AlertRowProps {
  readonly alertItem: AlertItem;
  readonly isAdmin: boolean;
  readonly acknowledging: boolean;
  readonly onAcknowledge: (id: string) => Promise<unknown>;
  /** Configured markets, to name the market of an alert raised in one. */
  readonly markets: readonly Market[];
}

function AlertRow({
  alertItem, isAdmin, acknowledging, onAcknowledge, markets
}: AlertRowProps) {
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded border px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[alertItem.severity]}`}>
              {SEVERITY_LABELS[alertItem.severity]}
            </span>
            <span className="text-xs font-medium text-gray-700">
              {ALERT_TYPE_LABELS[alertItem.type]}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
            {alertItem.group_name}
            {alertItem.market_id && alertItem.market_id !== GLOBAL_MARKET_ID && (
              <MarketBadge marketId={alertItem.market_id} markets={markets} />
            )}
          </p>
          <p className="mt-1 text-sm text-gray-700">{alertItem.message}</p>
          <MetricChange alertItem={alertItem} />
          {alertItem.content_change !== undefined && (
            <p className="mt-2 text-xs text-gray-500">
              Attributed content change: {alertItem.content_change.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <time
            className="text-xs text-gray-500"
            dateTime={alertItem.run_timestamp}
          >
            {formatDate(alertItem.run_timestamp)}
          </time>
          {isAdmin && alertItem.status === 'open' && (
            <button
              type="button"
              onClick={() => { void onAcknowledge(alertItem.id); }}
              disabled={acknowledging}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
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
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-2 flex h-5 items-center"><Skeleton className="h-3.5 w-40" /></div>
          <div className="mt-1 flex h-5 items-center"><Skeleton className="h-3.5 w-2/3" /></div>
        </SkeletonRegion>
      )}
      {!loading && error === null && items.length === 0 && (
        <p className="p-6 text-center text-sm text-gray-500">No open alerts.</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-gray-200">
          {items.map((alertItem) => (
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
    </section>
  );
}
