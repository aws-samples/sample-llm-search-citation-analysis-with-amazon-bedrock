import { vi } from 'vitest';
import type {
  ContentStudioHistory, ContentWarning, GeneratedContent
} from '../../types';

const DEFAULT_GENERATED_CONTENT: GeneratedContent = {
  title: 'Generated title',
  meta_description: 'Generated description',
  body: '## Useful section\n\nThis useful generated draft remains visible to the user.',
  suggested_headings: ['Useful section'],
  key_points: ['Useful point'],
};

export const incompleteMetadataWarning = {
  code: 'incomplete_metadata',
  message: 'This draft is usable, but some generated metadata is incomplete.',
  missing_fields: ['title', 'meta_description'],
} satisfies ContentWarning;

type HistoryOverrides = Omit<Partial<ContentStudioHistory>, 'generated_content'> & { generated_content?: Partial<GeneratedContent> };

export function buildContentStudioHistory(
  overrides: HistoryOverrides = {}
): ContentStudioHistory {
  const {
    generated_content: generatedContent, ...itemOverrides
  } = overrides;
  return {
    id: 'content-1',
    keyword: 'fallback keyword',
    idea_title: 'Idea title',
    content_angle: 'comprehensive_guide',
    generated_content: {
      ...DEFAULT_GENERATED_CONTENT,
      ...generatedContent,
    },
    competitor_sources_used: 0,
    status: 'generated',
    viewed: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...itemOverrides,
  };
}

export function createContentDetailModalProps(
  item: ContentStudioHistory,
  onCopy: (text: string) => void = vi.fn()
) {
  return {
    item,
    onClose: vi.fn(),
    onCopy,
    copied: false,
  };
}

export function createHistoryListItemProps(item: ContentStudioHistory) {
  return {
    item,
    deletingId: null,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
  };
}
