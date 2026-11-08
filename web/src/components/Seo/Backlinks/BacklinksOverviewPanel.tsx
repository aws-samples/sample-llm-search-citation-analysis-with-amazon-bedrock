import type { BacklinksOverviewResponse } from '../../../types/api/seoBacklinks';
import { ReportStatCard } from '../../Reports/layout/ReportStatCard';
import { ReportStatGrid } from '../../Reports/layout/ReportStatGrid';
import {
  compactText, integerText
} from '../../ui/numberFormat';
import { Chip } from '../../ui/tableCells';
import { BacklinksHistoryCharts } from './BacklinksCharts';
import {
  CACHED_NOTE, OVERVIEW_METRICS, formatMetric, scopeLabel
} from './backlinksFormat';
import { hasHistory } from './backlinksScope';

const SUBFOLDER_NOTE = 'A subfolder has totals only: backlinks and referring domains counted from its URLs, likely spam included.';
const PAGE_NOTE = 'An exact page has no history: DataForSEO keeps backlink history per hostname.';
const HISTORY_FAILED_NOTE = 'The history could not be loaded this time; search again in a few minutes to retry it.';
const HISTORY_LIMIT_NOTE = 'The history was not loaded: you have reached today\'s limit of paid DataForSEO calls. It resets at midnight UTC.';

function ScopeNote({ overview }: { readonly overview: BacklinksOverviewResponse }) {
  if (overview.scope === 'subfolder') return <p className="text-xs text-gray-500">{SUBFOLDER_NOTE}</p>;
  if (overview.scope === 'exact_url') return <p className="text-xs text-gray-500">{PAGE_NOTE}</p>;
  if (overview.history_failed) {
    return <p className="text-xs text-amber-700">{overview.history_limit_reached === true ? HISTORY_LIMIT_NOTE : HISTORY_FAILED_NOTE}</p>;
  }
  if (overview.scope === 'domain') {
    return <p className="text-xs text-gray-500">Metrics exclude subdomains; the charts include them (DataForSEO keeps history per hostname).</p>;
  }
  return null;
}

/** Scores (0-100) keep their decimal; counts are compact from 10,000 with the exact figure under them. */
const SCORE_KEYS: ReadonlySet<string> = new Set(['rank', 'backlinks_spam_score', 'target_spam_score']);

function MetricTile({
  label, help, value, score
}: {
  readonly label: string;
  readonly help: string;
  readonly value: number | null | undefined;
  readonly score: boolean;
}) {
  const shown = score ? formatMetric(value) : compactText(value);
  const exact = integerText(value);
  return <ReportStatCard label={label} value={shown} info={help} footnote={score || shown === exact ? undefined : `${exact} exactly`} />;
}

/** The overview metrics with their help texts, then the history charts where the scope has them. */
export function BacklinksOverviewPanel({ overview }: { readonly overview: BacklinksOverviewResponse }) {
  const summary = overview.summary ?? {};
  const metrics = OVERVIEW_METRICS.filter((metric) => overview.scope !== 'subfolder' || metric.key in summary);
  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900 break-all">{overview.target}</h3>
          <Chip>{scopeLabel(overview.scope)}</Chip>
          {overview.cached && <Chip tone="blue" title={CACHED_NOTE}>Cached</Chip>}
          <span className="text-xs text-gray-500">Updated {overview.fetched_at.slice(0, 16).replace('T', ' ')} UTC</span>
        </div>
        {overview.summary === null && <p className="text-sm text-gray-600">DataForSEO has no backlink data for this target yet.</p>}
        <ReportStatGrid columns={4}>
          {metrics.map((metric) => (
            <MetricTile key={metric.key} label={metric.label} help={metric.help} value={summary[metric.key]} score={SCORE_KEYS.has(metric.key)} />
          ))}
        </ReportStatGrid>
        <ScopeNote overview={overview} />
      </section>
      {hasHistory(overview.scope) && !overview.history_failed && (
        <BacklinksHistoryCharts trends={overview.trends} newLost={overview.new_lost_trends} />
      )}
    </div>
  );
}
