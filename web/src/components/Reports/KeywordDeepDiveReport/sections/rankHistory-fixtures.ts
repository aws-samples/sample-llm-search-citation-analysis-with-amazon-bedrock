import type {
  HistoricalTrendsResponse, TrendDataPoint 
} from '../../../../types';

/**
 * `count` daily points labelled `d-00`, `d-01`, … with a steadily rising
 * score, so a spec can check sampling keeps the endpoints by label.
 */
export function buildTrendPoints(count: number): TrendDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    period: `d-${i.toString().padStart(2, '0')}`,
    visibility_score: 40 + i,
    total_mentions: 1,
    provider_count: 1,
    best_rank: 1,
    analysis_runs: 1,
  }));
}

/** Per-keyword `/trends` payload whose summary is derived from `points`. */
export function buildTrendHistory(points: TrendDataPoint[]): HistoricalTrendsResponse {
  const scores = points.map((p) => p.visibility_score);
  return {
    period_type: 'day',
    days_analyzed: 30,
    data_points: points.length,
    trend_data: points,
    trend_direction: 'stable',
    summary: {
      current_score: scores[scores.length - 1] ?? 0,
      previous_score: scores[scores.length - 2] ?? 0,
      change: 0,
      change_percent: 0,
      average_score: scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1),
      max_score: Math.max(...scores, 0),
      min_score: Math.min(...scores, 0),
    },
  };
}
