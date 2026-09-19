import { vi } from 'vitest';
import type { useContentStudio } from '../../hooks/useContentStudio';
import type { ContentIdea } from '../../types';

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
    title: 'Hotels guide',
    description: 'Cover the hotels keyword',
    keyword: 'hotels',
    source: 'https://example.com/hotels',
    actionable: true,
    ...overrides,
  };
}
