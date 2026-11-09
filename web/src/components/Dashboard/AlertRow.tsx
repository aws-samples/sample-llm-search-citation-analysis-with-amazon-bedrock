import {
  GLOBAL_MARKET_ID,
  type AlertItem, type AlertMetricValue, type AlertSeverity, type AlertType, type Market
} from '../../types';
import { MarketBadge } from '../Markets/MarketBadge';
import { Button } from '../ui/Button';
import { formatDate } from '../../formatting/dateFormatter';

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
  warning: 'border-gray-200 bg-gray-50 text-amber-800',
};

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

export interface AlertRowProps {
  readonly alertItem: AlertItem;
  readonly isAdmin: boolean;
  readonly acknowledging: boolean;
  readonly onAcknowledge: (id: string) => Promise<unknown>;
  /** Configured markets, to name the market of an alert raised in one. */
  readonly markets: readonly Market[];
}

export function AlertRow({
  alertItem, isAdmin, acknowledging, onAcknowledge, markets
}: AlertRowProps) {
  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-sm border px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[alertItem.severity]}`}>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void onAcknowledge(alertItem.id); }}
              disabled={acknowledging}
            >
              {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
