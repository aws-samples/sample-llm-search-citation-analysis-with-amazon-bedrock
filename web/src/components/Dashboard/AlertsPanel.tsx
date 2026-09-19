import type {
  AlertItem, AlertMetricValue, AlertSeverity, AlertType
} from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { useOpenAlerts } from '../../hooks/useAlerts';
import { useIsAdmin } from '../../hooks/useIsAdmin';

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  citation_rate_drop: 'Citation-rate drop',
  position_loss: 'Position loss',
  new_competitor_top: 'New competitor in top results',
  keyword_lost_mention: 'Keyword lost mention',
  improvement_after_content_change: 'Improvement after content change',
};

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

const SEVERITY_CLASSES: Record<AlertSeverity, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-red-300 bg-red-50 text-red-800',
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
}

function AlertRow({
  alertItem, isAdmin, acknowledging, onAcknowledge
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
          <p className="mt-2 text-sm font-medium text-gray-900">{alertItem.group_name}</p>
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
        <button
          type="button"
          onClick={() => { void refresh(); }}
          disabled={loading}
          className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {actionError !== null && (
        <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loading && items.length === 0 && (
        <output className="block p-6 text-center text-sm text-gray-500">Loading alerts…</output>
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
            />
          ))}
        </ul>
      )}
    </section>
  );
}
