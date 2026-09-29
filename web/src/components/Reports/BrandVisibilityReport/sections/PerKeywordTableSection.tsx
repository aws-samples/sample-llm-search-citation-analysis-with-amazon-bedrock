import type {
  HistoricalTrendsResponse, KeywordTrend, TrendDirection
} from '../../../../types';
import { TREND_DEFINITION } from '../../../../constants/kpiDefinitions';
import {
  formatKpi, formatKpiDelta
} from '../../../../formatting/kpiFormatter';
import {
  kpiColumn,
  ReportSection,
  ReportTable,
  type ReportTableColumn,
} from '../../layout';
import { gateKeywordTrendRows } from './keywordTrendRows';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** A keyword's visibility-score trend since its previous period; `undefined` before it has one. */
function visibilityTrend(row: KeywordTrend): TrendDirection | undefined {
  return row.change?.trends.visibility_score;
}

function periodsText(row: KeywordTrend): string {
  return row.change === null ? row.period : `${row.change.previous_period} → ${row.period}`;
}

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function keywordColumns(): ReadonlyArray<ReportTableColumn<KeywordTrend>> {
  return [
    {
      header: 'Keyword',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-medium',
      render: (row) => row.keyword,
    },
    kpiColumn<KeywordTrend>('visibility_score', (row) => formatKpi('visibility_score', row.kpis.visibility_score)),
    {
      header: 'Visibility change',
      info: TREND_DEFINITION.definition,
      render: (row) => formatKpiDelta('visibility_score', row.change?.deltas.visibility_score),
    },
    {
      header: 'Trend',
      info: TREND_DEFINITION.definition,
      render: (row) => <TrendBadge trend={visibilityTrend(row)} />,
    },
    {
      header: 'Periods',
      info: 'The keyword\'s latest period with data, and the previous one its change is measured against.',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-mono text-xs whitespace-nowrap',
      render: periodsText,
    },
    kpiColumn<KeywordTrend>('mention_rate', (row) => formatKpi('mention_rate', row.kpis.mention_rate)),
    kpiColumn<KeywordTrend>('share_of_voice', (row) => formatKpi('share_of_voice', row.kpis.share_of_voice)),
  ];
}

/**
 * Per-keyword leaderboard for the all-keywords variant, in the API's order
 * (best visibility score first): each keyword's latest period and its
 * change since the keyword's previous one. Keywords whose visibility score
 * improves or declines (2 points or more) are tinted.
 */
export function PerKeywordTableSection({
  trends, loading, error 
}: Props) {
  const gate = gateKeywordTrendRows({
    title: 'Per-keyword leaderboard',
    loading,
    loadingMessage: 'Loading per-keyword rankings…',
    error,
    trends,
  });
  if (!gate.ready) return gate.placeholder;

  return (
    <ReportSection
      title="Per-keyword leaderboard"
      subtitle="Every keyword's latest period, strongest visibility score first. Keywords whose visibility score improved or declined by 2 points or more are highlighted."
    >
      <ReportTable
        columns={keywordColumns()}
        rows={gate.rows}
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        rowKey={(row) => row.keyword}
        rowClassName={(row) => trendRowClass(visibilityTrend(row))}
      />
    </ReportSection>
  );
}

function trendRowClass(trend: TrendDirection | undefined): string {
  if (trend === 'improving') return 'bg-emerald-50 dark:bg-emerald-950/20';
  if (trend === 'declining') return 'bg-red-50 dark:bg-red-950/20';
  return '';
}

// Stryker disable next-line ObjectLiteral: the badge palette is Tailwind-only; the badge text names the trend
const TREND_BADGE_STYLES: Readonly<Record<TrendDirection, string>> = {
  // Stryker disable next-line StringLiteral: improving badge colors are presentation-only
  improving: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  // Stryker disable next-line StringLiteral: declining badge colors are presentation-only
  declining: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  // Stryker disable next-line StringLiteral: stable badge colors are presentation-only
  stable: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function TrendBadge({ trend }: { readonly trend: TrendDirection | undefined }) {
  if (trend === undefined) return <>—</>;
  return (
    <span
      // Stryker disable next-line StringLiteral: Tailwind-only badge styling; the text below names the trend
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${TREND_BADGE_STYLES[trend]}`}
    >
      {trend}
    </span>
  );
}
