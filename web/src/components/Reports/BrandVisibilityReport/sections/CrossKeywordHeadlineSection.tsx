import type { HistoricalTrendsResponse } from '../../../../types';
import {
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  gateSection,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * All-keywords overview header — improving / declining / stable counts plus
 * the average score. Reads from `/trends` (no keyword) which already
 * computes these aggregates server-side.
 */
export function CrossKeywordHeadlineSection({
  trends, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading aggregate trends…',
    error,
    value: trends?.overall,
    emptyMessage: 'No aggregate trend data yet. Run an analysis to populate.',
  });
  if (!gate.ready) return gate.placeholder;
  const overall = gate.value;

  return (
    <ReportSection title="Headline">
      <ReportStatGrid columns={4}>
        <ReportStatCard label="Average score" value={overall.avg_score.toFixed(1)} />
        <ReportStatCard label="Improving" value={overall.improving_count.toString()} accent="positive" />
        <ReportStatCard label="Declining" value={overall.declining_count.toString()} accent="negative" />
        <ReportStatCard label="Stable" value={overall.stable_count.toString()} />
      </ReportStatGrid>
    </ReportSection>
  );
}
