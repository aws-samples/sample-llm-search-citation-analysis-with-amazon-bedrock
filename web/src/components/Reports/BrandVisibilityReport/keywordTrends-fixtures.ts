import type {
  HistoricalTrendsResponse, TrendDirection 
} from '../../../types';

interface KeywordTrendSeed {
  readonly keyword: string;
  readonly change: number;
  /** Defaults to `50 + change` so improvers sit above decliners. */
  readonly current_score?: number;
}

function directionFor(change: number): TrendDirection {
  if (change > 0) return 'improving';
  if (change < 0) return 'declining';
  return 'stable';
}

/**
 * All-keywords `/trends` payload: one `keyword_trends` row per seed, with the
 * `overall` aggregate derived from the seeds (counts by direction, mean
 * current score) so headline and leaderboard assertions agree with each other.
 */
export function buildKeywordTrends(
  rows: ReadonlyArray<KeywordTrendSeed>,
): HistoricalTrendsResponse {
  const keywordTrends = rows.map((row) => ({
    keyword: row.keyword,
    trend_direction: directionFor(row.change),
    current_score: row.current_score ?? 50 + row.change,
    change: row.change,
    change_percent: row.change * 2,
  }));
  const totalScore = keywordTrends.reduce((sum, row) => sum + row.current_score, 0);

  return {
    keyword_trends: keywordTrends,
    overall: {
      improving_count: rows.filter((row) => row.change > 0).length,
      declining_count: rows.filter((row) => row.change < 0).length,
      stable_count: rows.filter((row) => row.change === 0).length,
      avg_score: rows.length === 0 ? 0 : totalScore / rows.length,
    },
    period_type: 'day',
    days_analyzed: 30,
    trend_data: [],
    trend_direction: 'stable',
    summary: {
      current_score: 0,
      previous_score: 0,
      change: 0,
      change_percent: 0,
      average_score: 0,
      max_score: 0,
      min_score: 0,
    },
  };
}
