import type { HistoricalTrendsResponse } from '../../../../types';
import {
  MoverColumn, ReportSection, gateSection 
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const TOP_N = 5;
const NO_MOVERS_MESSAGE = 'No keywords moved in this direction.';

/**
 * Top improvers and top decliners side by side. The aggregator endpoint
 * (PR D) will eventually provide these directly; until then we sort the
 * `keyword_trends` array client-side by `change`. Five rows on each side
 * is the print-friendly default — enough to spot a campaign-level pattern
 * without bleeding onto a second page.
 */
export function MoversSection({
  trends, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Top movers',
    loading,
    loadingMessage: 'Computing movers…',
    error,
    value: trends,
  });
  if (!gate.ready) return gate.placeholder;

  const rows = gate.value.keyword_trends ?? [];
  if (rows.length === 0) return null;

  const improvers = [...rows]
    .filter((r) => r.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, TOP_N);
  const decliners = [...rows]
    .filter((r) => r.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, TOP_N);

  if (improvers.length === 0 && decliners.length === 0) return null;

  return (
    <ReportSection
      title="Top movers"
      subtitle="Keywords that shifted the most in the period. The improvers list is where momentum is paying off; the decliners list is where to investigate."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MoverColumn
          title="Improving"
          accent="positive"
          rows={improvers}
          emptyMessage={NO_MOVERS_MESSAGE}
        />
        <MoverColumn
          title="Declining"
          accent="negative"
          rows={decliners}
          emptyMessage={NO_MOVERS_MESSAGE}
        />
      </div>
    </ReportSection>
  );
}
