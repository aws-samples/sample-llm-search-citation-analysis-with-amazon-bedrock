import type { HistoricalTrendsResponse } from '../../../../types';
import {
  MoverColumn, ReportSection 
} from '../../layout';
import { gateKeywordTrendRows } from './keywordTrendRows';
import { keywordMovers } from './keywordMovers';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const NO_MOVERS_MESSAGE = 'No keyword\'s visibility score moved this way.';

/**
 * Top improvers and top decliners side by side: the keywords whose
 * visibility score improves or declines since their previous period (from
 * 2 points, as the API judges trends), largest move first, five a side —
 * enough to spot a campaign-level pattern without a second page.
 */
export function MoversSection({
  trends, loading, error 
}: Props) {
  const gate = gateKeywordTrendRows({
    title: 'Top movers',
    loading,
    loadingMessage: 'Loading movers…',
    error,
    trends,
  });
  if (!gate.ready) return gate.placeholder;

  const improvers = keywordMovers(gate.rows, 'improving');
  const decliners = keywordMovers(gate.rows, 'declining');
  if (improvers.length === 0 && decliners.length === 0) return null;

  return (
    <ReportSection
      title="Top movers"
      subtitle="Keywords whose visibility score improved or declined by 2 points or more since their previous period. Improvers show where momentum pays off; decliners where to investigate."
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
