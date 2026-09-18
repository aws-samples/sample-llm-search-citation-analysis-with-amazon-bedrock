import type { ReportsOverviewResponse } from '../../../../api/reports';
import {
  type ReportAccent,
  ReportSection,
  ReportStatCard,
  ReportStatGrid,
  gateSection,
} from '../../layout';

interface Props {
  readonly data: ReportsOverviewResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Top-of-deck hero metrics. The CMO question is "are we winning, level,
 * or losing right now"; three numbers answer that without scrolling:
 * overall score, the headline movement, and the breadth of motion
 * (improving vs declining keyword counts).
 */
export function HeadlineSection({
  data, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading executive summary…',
    error,
    value: data,
    emptyMessage: 'No analysis data yet. Run an analysis to populate the executive summary.',
  });
  if (!gate.ready) return gate.placeholder;

  const overview = gate.value;
  const movementAccent = movementAccentFor(overview.change);
  const movementText = formatMovement(overview.change, overview.change_percent);
  const { summary } = overview;

  return (
    <ReportSection title="Headline">
      <ReportStatGrid columns={3}>
        <ReportStatCard
          label="Overall visibility"
          value={overview.overall_score.toFixed(1)}
          footnote={`Across ${overview.keywords_analyzed} keywords, ${overview.days_analyzed} days`}
        />
        <ReportStatCard
          label="30-day movement"
          value={movementText}
          accent={movementAccent}
          footnote={overview.trend_direction.toUpperCase()}
        />
        <ReportStatCard
          label="Keyword breadth"
          value={`${summary.improving_count}/${summary.improving_count + summary.declining_count + summary.stable_count}`}
          accent={summary.improving_count >= summary.declining_count ? 'positive' : 'negative'}
          footnote={`${summary.declining_count} declining, ${summary.stable_count} stable`}
        />
      </ReportStatGrid>
    </ReportSection>
  );
}

function movementAccentFor(change: number): ReportAccent {
  if (change > 0) return 'positive';
  if (change < 0) return 'negative';
  return 'neutral';
}

function formatMovement(change: number, changePct: number): string {
  if (change === 0) return 'No change';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)} (${sign}${changePct.toFixed(1)}%)`;
}
