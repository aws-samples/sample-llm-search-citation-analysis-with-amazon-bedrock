import type {
  VisibilityMetricsResponse,
  HistoricalTrendsResponse,
} from '../../../../types';
import {
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
 * Per-keyword headline metrics: first-party score, share of voice, gap to
 * competitor average. These three numbers tell the marketing-lead reader
 * "are we ahead, level, or behind" before they read anything else in the
 * report.
 */
export function PerKeywordHeadlineSection({
  visibility, trends, loading, error,
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading visibility…',
    error,
    value: visibility,
    emptyMessage: 'No visibility data found for this keyword.',
  });
  if (!gate.ready) return gate.placeholder;

  const { summary } = gate.value;
  const fpScore = summary.first_party_avg_score;
  const compScore = summary.competitor_avg_score;
  const gap = (fpScore - compScore).toFixed(1);
  const gapAccent: 'positive' | 'negative' = fpScore >= compScore ? 'positive' : 'negative';
  const change = trends?.summary.change ?? 0;
  const changeText = formatChangeFootnote(change);

  return (
    <ReportSection title="Headline">
      <ReportStatGrid columns={3}>
        <ReportStatCard
          label="First-party visibility"
          value={`${fpScore.toFixed(1)}`}
          accent="neutral"
          footnote={changeText}
        />
        <ReportStatCard
          label="Share of voice"
          value={`${summary.first_party_total_sov.toFixed(1)}%`}
          accent="neutral"
          footnote={`Competitor SOV: ${summary.competitor_total_sov.toFixed(1)}%`}
        />
        <ReportStatCard
          label="Gap to competitor avg"
          value={`${gap.startsWith('-') ? '' : '+'}${gap}`}
          accent={gapAccent}
          footnote={`Competitor avg: ${compScore.toFixed(1)}`}
        />
      </ReportStatGrid>
    </ReportSection>
  );
}

function formatChangeFootnote(change: number): string {
  if (change === 0) return 'No 30-day change';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)} over 30 days`;
}
