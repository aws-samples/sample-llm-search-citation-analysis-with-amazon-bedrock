import type {
  CompetitorReportAllResponse, CompetitorReportSingleResponse 
} from '../api/reports';

export const mockSingleCompetitorRollup: CompetitorReportSingleResponse = {
  generated_at: '2026-05-15T07:00:00Z',
  keywords_analyzed: 4,
  competitor: 'Adidas',
  rollup: {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: [],
  },
};

export const mockAllCompetitorsRollup: CompetitorReportAllResponse = {
  generated_at: '2026-05-15T07:00:00Z',
  keywords_analyzed: 4,
  competitors: ['Adidas', 'Asics'],
  rollups: [
    {
      competitor: 'Adidas',
      outranked_keywords: [],
      exclusive_sources: [],
      outreach_targets: [],
    },
  ],
};
