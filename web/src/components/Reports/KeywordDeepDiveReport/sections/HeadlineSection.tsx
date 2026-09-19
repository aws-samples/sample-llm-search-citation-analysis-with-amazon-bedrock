import type {
  VisibilityMetricsResponse,
  HistoricalTrendsResponse,
  TrendDirection,
} from '../../../../types';
import {
  type ReportAccent,
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  gateSection,
} from '../../layout';

interface Props {
  readonly visibility: VisibilityMetricsResponse | null;
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The headline answer to "how is this keyword doing right now?". Shows the
 * first-party visibility score, the period-over-period change, and the trend
 * direction. Sized to dominate the first page of the printed report so a
 * skimmer can lift the bottom-line answer without reading further.
 */
export function HeadlineSection({
  visibility, trends, loading, error,
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading visibility…',
    error,
    value: visibility,
    emptyMessage: 'No visibility data found for this keyword. Run an analysis to populate the report.',
  });
  if (!gate.ready) return gate.placeholder;

  const score = gate.value.summary.first_party_avg_score;
  const sov = gate.value.summary.first_party_total_sov;
  const competitorScore = gate.value.summary.competitor_avg_score;

  const change = trends?.summary.change ?? 0;
  const direction = trends?.trend_direction ?? 'stable';

  const scoreAccent: ReportAccent =
    score >= competitorScore ? 'positive' : 'negative';
  const trendAccent = trendAccentFor(direction);
  const trendFootnote = formatTrendFootnote(change);

  return (
    <ReportSection title="Headline">
      <ReportStatGrid columns={3}>
        <ReportStatCard
          label="First-party visibility"
          value={`${score.toFixed(1)}`}
          accent={scoreAccent}
          footnote={`Competitor avg: ${competitorScore.toFixed(1)}`}
        />
        <ReportStatCard
          label="Share of voice"
          value={`${sov.toFixed(1)}%`}
          footnote="Across tracked first-party brands"
        />
        <ReportStatCard
          label="30-day trend"
          value={formatTrend(direction, change)}
          accent={trendAccent}
          footnote={trendFootnote}
        />
      </ReportStatGrid>
    </ReportSection>
  );
}

function formatTrendFootnote(change: number): string {
  if (change === 0) return 'No change since previous period';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)} since previous period`;
}

function trendAccentFor(direction: TrendDirection): ReportAccent {
  if (direction === 'improving') return 'positive';
  if (direction === 'declining') return 'negative';
  return 'neutral';
}

function formatTrend(direction: TrendDirection, change: number): string {
  if (direction === 'improving') return 'Improving';
  if (direction === 'declining') return 'Declining';
  return change === 0 ? 'Stable' : 'Stable (volatile)';
}
