import type { CompetitorReportResponse } from '../api/reports';

export const mockSingleCompetitorRollup: CompetitorReportResponse = {
  keywords_analyzed: 4,
  rollup: {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: [],
  },
};
