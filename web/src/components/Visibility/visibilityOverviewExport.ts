/**
 * Excel export of the Visibility tab for any scope: every KPI with its change
 * and trend, how each is measured, every keyword, the brand leaderboard and
 * the KPI history per period.
 *
 * An unknown value is an empty cell, never `null` or a dash, so a spreadsheet
 * can still compute with the column. KPI headings follow the per-group
 * report's export: "<Label> (%)", with the change in the Summary's Change
 * column in points (places for the average position).
 */
import {
  exportWorkbook, scopedExcelFileName, type ExcelSheet
} from '../../exporters/excelGenerator';
import type {
  BrandLeaderboardRow, HistoricalTrendsResponse, KeywordVisibilityRow, TrendDataPoint, VisibilityResponse
} from '../../types';
import type {
  BrandKpis, KpiTrend
} from '../../types/domain/groupKpiHistory';
import {
  KPI_DEFINITIONS, KPI_SPECS, VISIBILITY_DEFINITIONS, type KpiId, type KpiUnit
} from '../../constants/kpiDefinitions';

type Cell = string | number;
type Row = Record<string, Cell>;

/** The unit a KPI value heading ends with; counts and positions need none. */
const VALUE_HEADING_UNIT: Readonly<Record<KpiUnit, string>> = {
  percent: ' (%)',
  score: ' (0-100)',
  net: ' (-100 to +100)',
  count: '',
  position: '',
};

/** The heading of a KPI value, e.g. "Mention rate (%)" (the per-group report's convention). */
function kpiValueHeader(id: KpiId): string {
  const {
    label, unit
  } = KPI_DEFINITIONS[id];
  return `${label}${VALUE_HEADING_UNIT[unit]}`;
}

/** Column widths in characters: `fixed` first, then `perKpi` for each KPI. */
function columnWidths(fixed: readonly number[], perKpi: number | null): ExcelSheet['columns'] {
  const kpiWidths = perKpi === null ? [] : KPI_SPECS.map(() => perKpi);
  // Stryker disable next-line ObjectLiteral,ArrowFunction: column widths are presentation only
  return [...fixed, ...kpiWidths].map((wch) => ({ wch }));
}

/** Every KPI as one cell each; all empty when the KPIs are unknown. */
function kpiCells(kpis: BrandKpis | null): Row {
  return Object.fromEntries(KPI_SPECS.map((spec) => [kpiValueHeader(spec.id), kpis?.[spec.id] ?? '']));
}

function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

function contextRow(metric: string, value: Cell): Row {
  return {
    Metric: metric,
    Value: value,
    Change: '',
    Trend: '',
  };
}

function scopeContextRows(visibility: VisibilityResponse, trends: HistoricalTrendsResponse | null, scopeLabel: string): Row[] {
  const { kpis } = visibility;
  return [
    contextRow('Scope', scopeLabel),
    contextRow('Latest run', visibility.timestamp ?? ''),
    contextRow('Keywords analysed', visibility.keywords_analyzed),
    contextRow('Keywords with data', visibility.keywords_with_data),
    contextRow('Keywords truncated', yesNo(visibility.keywords_truncated)),
    contextRow('Owned domains configured', yesNo(visibility.citations_configured)),
    contextRow('AI engines', kpis.engines),
    contextRow('Keywords answered', kpis.keywords),
    contextRow('Positive mentions', kpis.sentiment_split.positive),
    contextRow('Neutral mentions', kpis.sentiment_split.neutral),
    contextRow('Negative mentions', kpis.sentiment_split.negative),
    contextRow('Mixed mentions', kpis.sentiment_split.mixed),
    contextRow('History period (days)', trends?.days_analyzed ?? ''),
    contextRow('History since', trends?.since ?? ''),
    contextRow('History grouped per', trends?.period_type ?? ''),
    contextRow('Change compared with', 'Each keyword\'s previous run'),
    contextRow('Keywords compared', visibility.change?.keywords_compared ?? ''),
  ];
}

function summarySheet(visibility: VisibilityResponse, trends: HistoricalTrendsResponse | null, scopeLabel: string): ExcelSheet {
  const { change } = visibility;
  const kpiTrends: Partial<Record<KpiId, KpiTrend>> = change?.trends ?? {};
  return {
    name: 'Summary',
    columns: columnWidths([38, 32, 18, 12], null),
    data: [
      ...scopeContextRows(visibility, trends, scopeLabel),
      ...KPI_SPECS.map((spec) => ({
        Metric: kpiValueHeader(spec.id),
        Value: visibility.kpis[spec.id] ?? '',
        Change: change?.deltas[spec.id] ?? '',
        Trend: kpiTrends[spec.id] ?? '',
      })),
    ],
  };
}

function definitionsSheet(): ExcelSheet {
  return {
    name: 'Definitions',
    columns: columnWidths([18, 120], null),
    data: VISIBILITY_DEFINITIONS.map(({
      label, definition
    }) => ({
      KPI: label,
      'How it is measured': definition,
    })),
  };
}

function keywordRow(row: KeywordVisibilityRow): Row {
  return {
    Keyword: row.keyword,
    'Has data': yesNo(row.has_data),
    'Latest run': row.timestamp ?? '',
    ...kpiCells(row.kpis),
  };
}

function brandRow(brand: BrandLeaderboardRow): Row {
  return {
    Brand: brand.name,
    Type: brand.classification,
    [kpiValueHeader('visibility_score')]: brand.visibility_score,
    [kpiValueHeader('mentions')]: brand.mentions,
    [kpiValueHeader('mention_rate')]: brand.mention_rate ?? '',
    [kpiValueHeader('share_of_voice')]: brand.share_of_voice ?? '',
    [kpiValueHeader('average_position')]: brand.average_position ?? '',
    'Best position': brand.best_position ?? '',
    [kpiValueHeader('net_sentiment')]: brand.net_sentiment ?? '',
    'AI engines': brand.engines.join(', '),
    Keywords: brand.keywords,
  };
}

function historyRow(point: TrendDataPoint): Row {
  return {
    Period: point.period,
    'Analysis runs': point.runs,
    'Keywords with data': point.keywords_with_data,
    ...kpiCells(point.kpis),
  };
}

/** Every sheet of the Visibility workbook; History is empty until trends are loaded. */
export function visibilityOverviewSheets(
  visibility: VisibilityResponse,
  trends: HistoricalTrendsResponse | null,
  scopeLabel: string
): ExcelSheet[] {
  return [
    summarySheet(visibility, trends, scopeLabel),
    definitionsSheet(),
    {
      name: 'Keywords',
      columns: columnWidths([40, 10, 28], 16),
      data: visibility.keywords.map(keywordRow),
    },
    {
      name: 'Brands',
      columns: columnWidths([30, 14, 18, 12, 18, 18, 18, 14, 22, 30, 10], null),
      data: visibility.brands.map(brandRow),
    },
    {
      name: 'History',
      columns: columnWidths([14, 14, 18], 16),
      data: trends?.trend_data.map(historyRow) ?? [],
    },
  ];
}

export function visibilityOverviewFileName(scopeLabel: string, date = new Date()): string {
  return scopedExcelFileName('visibility', scopeLabel, date);
}

export async function exportVisibilityOverview(
  visibility: VisibilityResponse,
  trends: HistoricalTrendsResponse | null,
  scopeLabel: string
): Promise<void> {
  await exportWorkbook(visibilityOverviewSheets(visibility, trends, scopeLabel), visibilityOverviewFileName(scopeLabel));
}
