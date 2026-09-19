import type { ReportsOverviewResponse } from '../../../../api/reports';

export function buildData(overrides: Partial<ReportsOverviewResponse> = {}): ReportsOverviewResponse {
  return {
    generated_at: '2026-05-15T07:00:00Z',
    period_type: 'day',
    days_analyzed: 30,
    keywords_analyzed: 10,
    overall_score: 60,
    previous_score: 55,
    change: 5,
    change_percent: 9.1,
    trend_direction: 'improving',
    summary: {
      improving_count: 4,
      declining_count: 2,
      stable_count: 4
    },
    top_improving: [],
    top_declining: [],
    top_recommendations: [],
    ...overrides,
  };
}
