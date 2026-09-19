import { vi } from 'vitest';
import type { useContentStudio } from '../../hooks/useContentStudio';
import type {
  ContentIdea, GroupBriefIdea
} from '../../types';

type ContentStudioHookResult = ReturnType<typeof useContentStudio>;

/** An idle studio: nothing generated yet, nothing loading, no ideas. */
export function buildContentStudioHookResult(
  overrides: Partial<ContentStudioHookResult> = {}
): ContentStudioHookResult {
  return {
    ideas: [],
    history: [],
    unviewedCount: 0,
    loading: false,
    generating: false,
    error: null,
    fetchIdeas: vi.fn(),
    fetchHistory: vi.fn(),
    generateContent: vi.fn(),
    markViewed: vi.fn(),
    deleteContent: vi.fn(),
    refreshGeneratingItems: vi.fn(),
    ...overrides,
  };
}

export function buildActionableIdea(overrides: Partial<ContentIdea> = {}): ContentIdea {
  return {
    id: '1',
    type: 'visibility_gap',
    priority: 'high',
    title: 'Search visibility guide',
    description: 'Cover a useful cross-industry search topic',
    keyword: 'product comparisons',
    source: 'https://example.com/analysis',
    actionable: true,
    ...overrides,
  };
}

export function buildGroupBriefIdea(
  overrides: Partial<GroupBriefIdea> = {}
): GroupBriefIdea {
  return {
    id: 'group-brief-1',
    type: 'group_brief',
    priority: 'medium',
    title: 'Group Brief: Generic Group',
    description: 'Create a complete landing page from selected active keywords.',
    keyword: 'Generic Group',
    source: 'group_brief',
    actionable: true,
    content_angle: 'create_new_landing_page',
    group_id: 'group-1',
    group_name: 'Generic Group',
    keyword_ids: ['keyword-1'],
    keywords: ['Alpha keyword'],
    landing_url: '',
    current_copy: '',
    prompt_template: 'Create for {group} with {keywords}.',
    output_language: 'English',
    competitor_urls: [],
    ...overrides,
  };
}
