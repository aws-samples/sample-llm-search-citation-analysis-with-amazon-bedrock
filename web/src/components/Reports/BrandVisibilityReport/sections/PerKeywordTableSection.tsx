import type {
  HistoricalTrendsResponse, TrendDirection 
} from '../../../../types';
import {
  ReportSection,
  ReportTable,
  type ReportTableColumn,
  gateSection,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

type KeywordTrendRow = NonNullable<HistoricalTrendsResponse['keyword_trends']>[number];

/**
 * Per-keyword leaderboard for the all-keywords variant. Sorted by current
 * score descending so the strongest performers anchor the top of the page.
 *
 * Movers (`change` rows where the magnitude is >= 5 points) are highlighted
 * with a positive/negative tint so a reader can spot the keywords that
 * actually shifted in the period without computing the deltas themselves.
 */
const MOVE_THRESHOLD = 5;

const COLUMNS: ReadonlyArray<ReportTableColumn<KeywordTrendRow>> = [
  {
    header: 'Keyword',
    cellClassName: 'font-medium',
    render: (row) => row.keyword,
  },
  {
    header: 'Score',
    render: (row) => row.current_score.toFixed(1),
  },
  {
    header: 'Change',
    render: (row) => `${row.change > 0 ? '+' : ''}${row.change.toFixed(1)}`,
  },
  {
    header: '%',
    render: (row) => `${row.change_percent > 0 ? '+' : ''}${row.change_percent.toFixed(1)}%`,
  },
  {
    header: 'Direction',
    render: (row) => <DirectionBadge direction={row.trend_direction} />,
  },
];

export function PerKeywordTableSection({
  trends, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Per-keyword leaderboard',
    loading,
    loadingMessage: 'Loading per-keyword rankings…',
    error,
    value: trends,
  });
  if (!gate.ready) return gate.placeholder;

  const rows = gate.value.keyword_trends ?? [];
  if (rows.length === 0) {
    return null;
  }

  const sorted = [...rows].sort((a, b) => b.current_score - a.current_score);

  return (
    <ReportSection
      title="Per-keyword leaderboard"
      subtitle="Current score and 30-day change for every tracked keyword. Sorted strongest to weakest. Movers (≥5 points) are highlighted."
    >
      <ReportTable
        columns={COLUMNS}
        rows={sorted}
        rowKey={(row) => row.keyword}
        rowClassName={(row) => moverRowClass(row.change)}
      />
    </ReportSection>
  );
}

function moverRowClass(change: number): string {
  if (Math.abs(change) < MOVE_THRESHOLD) return '';
  if (change > 0) return 'bg-emerald-50 dark:bg-emerald-950/20';
  return 'bg-red-50 dark:bg-red-950/20';
}

function DirectionBadge({ direction }: { readonly direction: TrendDirection }) {
  const styles = directionStyles(direction);
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${styles}`}
    >
      {direction}
    </span>
  );
}

function directionStyles(d: TrendDirection): string {
  if (d === 'improving') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  }
  if (d === 'declining') {
    return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}
