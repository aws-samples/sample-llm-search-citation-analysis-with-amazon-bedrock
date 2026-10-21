import type { CompetitorReportResponse } from '../api/reports';

export const mockSingleCompetitorRollup: CompetitorReportResponse = {
  keywords_analyzed: 4,
  rollup: {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_source_count: 0,
    high_priority_source_count: 0,
    outreach_targets: [],
  },
};
