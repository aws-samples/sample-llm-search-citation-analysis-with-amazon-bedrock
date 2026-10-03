/**
 * Excel export of the Visibility tab for any scope: every KPI with its change
 * and trend, how each is measured, every keyword, the brand leaderboard,
 * every KPI per AI engine, the most cited domains and the KPI history per
 * period.
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
  BrandLeaderboardRow, EngineKpis, HistoricalTrendsResponse, KeywordVisibilityRow, SourceRow, TrendDataPoint, VisibilityResponse
} from '../../types';
import type { KpiTrend } from '../../types/domain/groupKpiHistory';
import {
  KPI_DEFINITIONS, KPI_SPECS, VISIBILITY_DEFINITIONS, type KpiId
} from '../../constants/kpiDefinitions';
import {
  contextRow, definitionsSheet, kpiCells, kpiSummaryRows, kpiValueHeader as kpiSpecHeader, sheetWidths, yesNo, type Cell
} from '../Reports/layout/kpiSheets';

type Row = Record<string, Cell>;

/** The heading of a KPI value, e.g. "Mention rate (%)" (the per-group report's convention). */
function kpiValueHeader(id: KpiId): string {
  return kpiSpecHeader(KPI_DEFINITIONS[id]);
}

/** Column widths in characters: `fixed` first, then `perKpi` for each KPI. */
function columnWidths(fixed: readonly number[], perKpi: number | null): ExcelSheet['columns'] {
  // Stryker disable next-line ArrowFunction: the per-KPI width is presentation only; the column count is pinned by the specs
  const kpiWidths = perKpi === null ? [] : KPI_SPECS.map(() => perKpi);
  return sheetWidths(...fixed, ...kpiWidths);
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
    contextRow('Cited domains', visibility.sources_total),
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
      ...kpiSummaryRows(visibility.kpis, change?.deltas, (id) => kpiTrends[id]),
    ],
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

function engineRow(engine: EngineKpis): Row {
  return {
    'AI engine': engine.engine,
    ...kpiCells(engine.kpis),
  };
}

function sourceRow(source: SourceRow): Row {
  return {
    Domain: source.domain,
    Owned: yesNo(source.owned),
    [kpiValueHeader('citations')]: source.citations,
    [kpiValueHeader('citation_rate')]: source.citation_rate ?? '',
    [kpiValueHeader('citation_share')]: source.citation_share ?? '',
    'AI engines': source.engines.join(', '),
    Keywords: source.keywords,
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
    definitionsSheet(VISIBILITY_DEFINITIONS),
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
      name: 'Engines',
      columns: columnWidths([14], 16),
      data: visibility.engines.map(engineRow),
    },
    {
      name: 'Sources',
      columns: columnWidths([36, 8, 12, 18, 18, 30, 10], null),
      data: visibility.sources.map(sourceRow),
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
