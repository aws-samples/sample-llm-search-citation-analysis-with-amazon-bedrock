import type { ReportsOverviewResponse } from '../api/reports';

export const mockReportsOverview: ReportsOverviewResponse = {
  generated_at: '2026-05-14T12:00:00Z',
  period_type: 'day',
  days_analyzed: 30,
  keywords_analyzed: 4,
  overall_score: 57.5,
  previous_score: 57.0,
  change: 0.5,
  change_percent: 0.9,
  trend_direction: 'stable',
  summary: {
    improving_count: 2,
    declining_count: 1,
    stable_count: 1 
  },
  top_improving: [
    {
      keyword: 'a',
      current_score: 80,
      change: 8,
      change_percent: 11.1,
      trend_direction: 'improving' 
    },
  ],
  top_declining: [
    {
      keyword: 'c',
      current_score: 30,
      change: -10,
      change_percent: -25,
      trend_direction: 'declining' 
    },
  ],
  top_recommendations: [
    {
      type: 'gap',
      priority: 'high',
      title: 'r1',
      description: 'd',
      action: 'a',
      impact: 'i' 
    },
  ],
};
