import type {
  KeywordTrend, TrendDirection
} from '../../../../types';
import type { KeywordMover } from '../../layout';

/** How many keywords each side of the movers panel lists. */
export const TOP_MOVERS = 5;

/**
 * The keywords whose visibility score trends `trend` since their previous
 * period (the API's 2-point rule), largest move first, at most `TOP_MOVERS`.
 * Equal moves keep the API order: best visibility score first.
 */
export function keywordMovers(rows: readonly KeywordTrend[], trend: Exclude<TrendDirection, 'stable'>): KeywordMover[] {
  return rows
    .flatMap((row) => {
      const delta = row.change?.trends.visibility_score === trend ? row.change.deltas.visibility_score : null;
      return delta === null ? [] : [{
        keyword: row.keyword,
        visibility_score: row.kpis.visibility_score,
        change: delta,
      }];
    })
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))
    .slice(0, TOP_MOVERS);
}
