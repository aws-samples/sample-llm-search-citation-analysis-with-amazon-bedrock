/**
 * Excel exports of one Lighthouse result: its top opportunities (the failed audits, savings as raw numbers, the
 * description as Lighthouse wrote it, Markdown links kept as text) and its six page speed metrics. Each file is
 * named after the measured page and device.
 */
import {
  type ExcelTableColumn, exportTableToExcel, rounded, yesNo
} from '../../../exporters/tableExcel';
import type {
  CompletedResult, LighthouseAudit
} from '../../../types/api/seoPerformance';
import {
  METRICS, RATING_LABELS, SCORE_LABELS, metricRating, type MetricDefinition
} from './performanceFormat';

export const OPPORTUNITY_COLUMNS: ReadonlyArray<ExcelTableColumn<LighthouseAudit>> = [
  {
    header: 'Severity',
    value: (audit) => audit.severity,
  },
  {
    header: 'Category',
    value: (audit) => SCORE_LABELS[audit.category],
  },
  {
    header: 'Audit',
    value: (audit) => audit.title,
  },
  {
    header: 'Savings (ms)',
    value: (audit) => rounded(audit.savings_ms, 0),
  },
  {
    header: 'Savings (bytes)',
    value: (audit) => rounded(audit.savings_bytes, 0),
  },
  {
    header: 'Score (0-100)',
    value: (audit) => audit.score,
  },
  {
    header: 'Description',
    value: (audit) => audit.description,
  },
];

/** A metric with its measured value (`null` when the lab run could not measure it). */
export interface MetricExportRow {
  readonly metric: MetricDefinition;
  readonly value: number | null;
}

export const METRIC_COLUMNS: ReadonlyArray<ExcelTableColumn<MetricExportRow>> = [
  {
    header: 'Metric',
    value: (row) => row.metric.label,
  },
  {
    header: 'Core Web Vital',
    value: (row) => yesNo(row.metric.coreWebVital),
  },
  {
    header: 'Value',
    value: (row) => rounded(row.value, row.metric.unit === 'ms' ? 0 : 3),
  },
  {
    header: 'Unit',
    value: (row) => (row.metric.unit === 'ms' ? 'ms' : null),
  },
  {
    header: 'Rating',
    value: (row) => (row.value === null ? null : RATING_LABELS[metricRating(row.value, row.metric)]),
  },
  {
    header: 'Good up to',
    value: (row) => row.metric.good,
  },
  {
    header: 'Poor above',
    value: (row) => row.metric.poor,
  },
];

/** The rows of the page speed metrics table, in its order. */
export function metricRows(result: CompletedResult): MetricExportRow[] {
  return METRICS.map((metric) => ({
    metric,
    value: result.metrics[metric.key],
  }));
}

function resultScope(result: CompletedResult): string {
  return `${result.url} ${result.device}`;
}

export function exportOpportunitiesExcel(result: CompletedResult): Promise<void> {
  return exportTableToExcel({
    columns: OPPORTUNITY_COLUMNS,
    rows: result.failed_audits,
    sheetName: 'Top opportunities',
    filePrefix: 'lighthouse-opportunities',
    scopeLabel: resultScope(result),
  });
}

export function exportMetricsExcel(result: CompletedResult): Promise<void> {
  return exportTableToExcel({
    columns: METRIC_COLUMNS,
    rows: metricRows(result),
    sheetName: 'Page speed metrics',
    filePrefix: 'lighthouse-metrics',
    scopeLabel: resultScope(result),
  });
}
