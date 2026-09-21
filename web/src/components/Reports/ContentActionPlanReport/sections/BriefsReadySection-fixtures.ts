import type {
  ContentStudioHistory, ContentWarning
} from '../../../../types';

export const incompleteMetadataWarning = {
  code: 'incomplete_metadata',
  message: 'This draft is usable, but some generated metadata is incomplete.',
  missing_fields: ['title', 'meta_description'],
} satisfies ContentWarning;

interface BriefOptions {
  readonly contentWarning?: ContentWarning;
  readonly generatedTitle?: string;
  readonly ideaTitle?: string;
  readonly keyword?: string;
}

export function buildBrief(
  id: string,
  title: string,
  status: 'generated' | 'pending' | 'failed' | 'generating',
  options: BriefOptions = {},
): ContentStudioHistory {
  return {
    id,
    keyword: options.keyword ?? 'kw',
    idea_title: options.ideaTitle ?? title,
    content_angle: 'comprehensive_guide',
    generated_content: {
      title: options.generatedTitle ?? title,
      meta_description: 'm',
      body: 'b',
      suggested_headings: [],
      key_points: ['Point A', 'Point B', 'Point C', 'Point D', 'Point E'],
    },
    content_warning: options.contentWarning,
    competitor_sources_used: 0,
    status,
    viewed: false,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  };
}
