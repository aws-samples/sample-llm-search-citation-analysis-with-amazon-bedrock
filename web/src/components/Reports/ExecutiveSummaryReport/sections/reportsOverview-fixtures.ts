import type {
  ReportsOverviewMover,
  ReportsOverviewResponse,
} from '../../../../api/reports';
import type { Recommendation } from '../../../../types';

interface OverviewSeed {
  readonly improving?: ReportsOverviewMover[];
  readonly declining?: ReportsOverviewMover[];
  readonly recommendations?: Recommendation[];
}

/**
 * `/reports/overview` payload with neutral headline numbers, so a section
 * spec only has to supply the list it is exercising.
 */
export function buildOverview({
  improving = [],
  declining = [],
  recommendations = [],
}: OverviewSeed = {}): ReportsOverviewResponse {
  return {
    top_improving: improving,
    top_declining: declining,
    top_recommendations: recommendations,
    generated_at: '2026-05-15T07:00:00Z',
    period_type: 'day',
    days_analyzed: 30,
    keywords_analyzed: 10,
    overall_score: 60,
    previous_score: 55,
    change: 5,
    change_percent: 9.1,
    trend_direction: 'stable',
    summary: {
      improving_count: 0,
      declining_count: 0,
      stable_count: 0,
    },
  };
}
