import {
  MoverColumn, ReportSection, type KeywordMover, type TrendSectionProps
} from '../../layout';
import { gateKeywordTrendRows } from './keywordTrendRows';
import { keywordMovers } from './keywordMovers';
import { SeeAllLink } from '../../../ui/SeeAllLink';
import { PER_KEYWORD_ANCHOR } from './PerKeywordTableSection';
import type { HistoricalTrendsResponse } from '../../../../types';

/**
 * The movers each way: the server's, ranked over every keyword of the scope (2.45.0 wave 5); an
 * older answer without them is ranked here over the keywords it lists.
 */
function moversOf(trends: HistoricalTrendsResponse | null, rows: Parameters<typeof keywordMovers>[0]): {
  improvers: KeywordMover[];
  decliners: KeywordMover[];
} {
  if (trends?.top_movers !== undefined) {
    return {
      improvers: trends.top_movers.improving,
      decliners: trends.top_movers.declining,
    };
  }
  return {
    improvers: keywordMovers(rows, 'improving'),
    decliners: keywordMovers(rows, 'declining'),
  };
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
}: TrendSectionProps) {
  const gate = gateKeywordTrendRows({
    title: 'Top movers',
    loading,
    loadingMessage: 'Loading movers…',
    error,
    trends,
  });
  if (!gate.ready) return gate.placeholder;

  const {
    improvers, decliners
  } = moversOf(trends, gate.rows);
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
      <p className="mt-2 text-right"><SeeAllLink to={`#${PER_KEYWORD_ANCHOR}`}>See all keywords</SeeAllLink></p>
    </ReportSection>
  );
}
