import type {
  PeriodType, ScopeChange
} from '../../../types';
import type { KpiComparison } from './KpiHeadline';

function comparison(change: ScopeChange, against: string): KpiComparison {
  const keywords = change.keywords_compared === 1 ? '1 keyword' : `${change.keywords_compared} keywords`;
  return {
    deltas: change.deltas,
    trends: change.trends,
    label: `vs previous ${against} (${keywords})`,
  };
}

/**
 * The `KpiHeadline` comparison of a `/trends` change: the latest period
 * against the previous one, like for like over the keywords measured in
 * both; `null` before a second period.
 */
export function periodComparison(change: ScopeChange | null, period: PeriodType): KpiComparison | null {
  return change === null ? null : comparison(change, period);
}

/**
 * The `KpiHeadline` comparison of a `/visibility` change: each keyword's
 * latest run against its previous run, like for like over the keywords
 * answered in both; `null` without such a keyword.
 */
export function runComparison(change: ScopeChange | null): KpiComparison | null {
  return change === null ? null : comparison(change, 'run');
}

/** What a headline says before there are two periods to compare. */
export const NO_PREVIOUS_PERIOD = 'No earlier period to compare with yet';

/** What a headline says before there are two runs to compare. */
export const NO_PREVIOUS_RUN = 'No earlier run to compare with yet';
