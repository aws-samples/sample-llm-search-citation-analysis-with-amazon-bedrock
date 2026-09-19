import type { ContentStudioHistory } from '../../../../types';

export function buildBrief(
  id: string,
  title: string,
  status: 'generated' | 'pending' | 'failed' | 'generating',
): ContentStudioHistory {
  return {
    id,
    keyword: 'kw',
    idea_type: 'visibility_gap',
    idea_title: title,
    content_angle: 'comprehensive_guide',
    generated_content: {
      title,
      meta_description: 'm',
      body: 'b',
      suggested_headings: [],
      key_points: ['Point A', 'Point B', 'Point C', 'Point D', 'Point E'],
    },
    raw_content: '',
    competitor_sources_used: 0,
    status,
    viewed: false,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  };
}
