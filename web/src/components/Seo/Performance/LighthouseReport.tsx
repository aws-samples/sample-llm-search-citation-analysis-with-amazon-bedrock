/**
 * One measured page: its four category scores, its metrics against their thresholds and the top fixes; the
 * metrics and the fixes each export to Excel.
 */
import type {
  CompletedResult, LighthouseAudit, LighthouseResult, LighthouseScores
} from '../../../types/api/seoPerformance';
import { safeHref } from '../../../infrastructure';
import { ExportExcelButton } from '../../ui/ExportExcelButton';
import {
  exportMetricsExcel, exportOpportunitiesExcel
} from './lighthouseExcel';
import {
  METRICS, RATING_CLASSES, RATING_LABELS, SCORE_LABELS, descriptionParts, deviceLabel, formatMetric, metricRating,
  savingsText, scoreRating, thresholdNote, type MetricDefinition
} from './performanceFormat';

const SCORE_KEYS = Object.keys(SCORE_LABELS) as (keyof LighthouseScores)[];
const SEVERITY_CLASSES: Record<LighthouseAudit['severity'], string> = {
  critical: 'bg-red-100 text-red-800',
  warning: 'bg-gray-100 text-amber-800',
  info: 'bg-gray-100 text-gray-700',
};

function ScoreTile({
  label, score
}: {
  readonly label: string;
  readonly score: number | null;
}) {
  const rating = score === null ? null : scoreRating(score);
  return (
    <div className={`rounded-lg p-3 text-center ${rating === null ? 'bg-gray-100 text-gray-600' : RATING_CLASSES[rating]}`}>
      <p className="text-2xl font-semibold" aria-label={`${label} score`}>{score === null ? '–' : String(score)}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function MetricRow({
  metric, value
}: {
  readonly metric: MetricDefinition;
  readonly value: number | null;
}) {
  const rating = value === null ? null : metricRating(value, metric);
  return (
    <tr>
      <th scope="row" className="px-3 py-2 text-left font-normal text-gray-800 dark:text-gray-200">
        {metric.label}
        {metric.coreWebVital && <span className="ml-2 text-xs text-gray-500">Core Web Vital</span>}
      </th>
      <td className="px-3 py-2 font-medium">{formatMetric(value, metric.unit)}</td>
      <td className="px-3 py-2">
        {rating === null
          ? <span className="text-xs text-gray-500">Not measured</span>
          : <span className={`rounded px-2 py-0.5 text-xs ${RATING_CLASSES[rating]}`}>{RATING_LABELS[rating]}</span>}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{thresholdNote(metric)}</td>
    </tr>
  );
}

/** The description with its Markdown links as links (an unsafe target stays text). */
function AuditDescription({ text }: { readonly text: string }) {
  return (
    <p className="mt-1 text-xs text-gray-600">
      {descriptionParts(text).map((part, index) => {
        const href = part.href === undefined ? undefined : safeHref(part.href);
        const key = `${index}-${part.text}`;
        return href === undefined
          ? <span key={key}>{part.text}</span>
          : <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-900 dark:hover:text-gray-50">{part.text}</a>;
      })}
    </p>
  );
}

function AuditItem({ audit }: { readonly audit: LighthouseAudit }) {
  const savings = savingsText(audit.savings_ms, audit.savings_bytes);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_CLASSES[audit.severity]}`}>{audit.severity}</span>
        <span className="font-medium text-gray-900">{audit.title}</span>
        <span className="text-xs text-gray-500">{SCORE_LABELS[audit.category]}</span>
        {savings !== '' && <span className="text-xs text-gray-600">{savings}</span>}
      </div>
      {audit.description !== '' && <AuditDescription text={audit.description} />}
    </li>
  );
}

function CompletedReport({ result }: { readonly result: CompletedResult }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SCORE_KEYS.map((key) => <ScoreTile key={key} label={SCORE_LABELS[key]} score={result.scores[key]} />)}
      </div>
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-gray-900">Metrics</h5>
        <ExportExcelButton onExport={() => exportMetricsExcel(result)} failureLabel="[seo] Lighthouse metrics Excel export failed:"
          title="The six page speed metrics of this result" />
      </div>
      <table className="min-w-full text-sm" aria-label="Page speed metrics">
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {METRICS.map((metric) => <MetricRow key={metric.key} metric={metric} value={result.metrics[metric.key]} />)}
        </tbody>
      </table>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-semibold text-gray-900">Top opportunities</h5>
          <ExportExcelButton onExport={() => exportOpportunitiesExcel(result)}
            failureLabel="[seo] Lighthouse opportunities Excel export failed:" disabled={result.failed_audits.length === 0}
            title="The failed audits of this result" />
        </div>
        {result.failed_audits.length === 0
          ? <p className="text-sm text-gray-600">No failed audit: nothing to fix on this page.</p>
          : <ul className="divide-y divide-gray-100 dark:divide-gray-700">{result.failed_audits.map((audit) => <AuditItem key={audit.id} audit={audit} />)}</ul>}
      </div>
    </div>
  );
}

function ResultBody({ result }: { readonly result: LighthouseResult | null }) {
  if (result === null) return <p className="text-sm text-gray-500">Waiting to be measured…</p>;
  if (result.status === 'measuring') return <p className="text-sm text-gray-500">Measuring (up to a minute)…</p>;
  if (result.status === 'failed') {
    return <p role="alert" className="text-sm text-red-700">{result.error}</p>;
  }
  return <CompletedReport result={result} />;
}

export function LighthouseReport({
  url, device, result
}: {
  readonly url: string;
  readonly device: 'mobile' | 'desktop';
  readonly result: LighthouseResult | null;
}) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 space-y-3" aria-label={`${url} on ${device}`}>
      <h4 className="text-sm font-semibold text-gray-900 break-all">
        {url} <span className="font-normal text-gray-500">· {deviceLabel(device)}</span>
      </h4>
      <ResultBody result={result} />
    </article>
  );
}
