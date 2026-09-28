import type {
  HistoricalTrendsResponse, PeriodType
} from '../../../types';
import type { KpiComparison } from './KpiHeadline';

/**
 * The `KpiHeadline` comparison of a trend change: the latest period against
 * the previous one, like for like over the keywords measured in both;
 * `null` before a second period.
 */
export function periodComparison(change: HistoricalTrendsResponse['change'], period: PeriodType): KpiComparison | null {
  if (change === null) return null;
  const keywords = change.keywords_compared === 1 ? '1 keyword' : `${change.keywords_compared} keywords`;
  return {
    deltas: change.deltas,
    trends: change.trends,
    label: `vs previous ${period} (${keywords})`,
  };
}

/** What a headline says before there are two periods to compare. */
export const NO_PREVIOUS_PERIOD = 'No earlier period to compare with yet';
