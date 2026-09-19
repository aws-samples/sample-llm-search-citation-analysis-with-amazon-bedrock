import type {
  CitationGapsResponse,
  ContentIdea,
  ContentStudioHistory,
} from '../../../../types';

export function buildGaps(
  summaries: Array<{
    keyword: string;
    gap_count: number;
    high_priority_gaps: number;
  }>,
): CitationGapsResponse {
  return {
    summary: {
      gap_count: summaries.reduce((total, summary) => total + summary.gap_count, 0),
      high_priority_gaps: summaries.reduce((total, summary) => total + summary.high_priority_gaps, 0),
      covered_count: 0,
      coverage_rate: 0,
    },
    keyword_summaries: summaries.map((summary) => ({
      keyword: summary.keyword,
      gap_count: summary.gap_count,
      high_priority_gaps: summary.high_priority_gaps,
      coverage_rate: 0,
    })),
    gaps: [],
    covered_sources: [],
    domain_summary: [],
  };
}

export function brief(
  id: string,
  keyword: string,
  status: 'generated' | 'pending' | 'failed' | 'generating'
): ContentStudioHistory {
  return {
    id,
    keyword,
    idea_title: id,
    content_angle: 'comprehensive_guide',
    generated_content: {
      title: id,
      meta_description: 'm',
      body: 'b',
      suggested_headings: [],
      key_points: [],
    },
    competitor_sources_used: 0,
    status,
    viewed: false,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  };
}

export function idea(id: string, keyword: string | null): ContentIdea {
  return {
    id,
    type: 'visibility_gap',
    priority: 'high',
    title: id,
    description: 'd',
    keyword,
    source: 'analysis',
    actionable: true,
    content_angle: 'comprehensive_guide',
  };
}
