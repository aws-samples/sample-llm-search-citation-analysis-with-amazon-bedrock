import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  buildApiBatchRequest, buildApiGroupBriefIdea
} from '../../api/contentStudio-fixtures';
import type { useContentStudio } from '../../hooks/useContentStudio';
import type {
  ContentBriefBatchCounts,
  ContentBriefBatchRequest,
  ContentBriefBatchStatusResponse,
  ContentIdea,
  GroupBriefIdea,
} from '../../types';

type ContentStudioHookResult = ReturnType<typeof useContentStudio>;

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
    activeBatches: [],
    fetchIdeas: vi.fn(),
    fetchHistory: vi.fn(),
    generateContent: vi.fn(),
    generateContentBatch: vi.fn(),
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
  return buildApiGroupBriefIdea({
    id: 'group-brief-1',
    ...overrides,
  });
}

export function buildContentBriefBatchRequest(
  overrides: Partial<ContentBriefBatchRequest> = {}
): ContentBriefBatchRequest {
  return buildApiBatchRequest({
    batch_id: 'content-brief-batch-1',
    ...overrides,
  });
}

export function buildActiveBatch(
  overrides: Partial<ContentBriefBatchStatusResponse> = {}
): ContentBriefBatchStatusResponse {
  return {
    batch_id: 'content-brief-batch-1',
    batch_size: 3,
    children: [],
    counts: {
      pending: 1,
      generating: 1,
      generated: 0,
      failed: 1,
      missing: 0,
      total: 3,
    },
    ...overrides,
  };
}

export function buildProgressBatch(
  countOverrides: Partial<ContentBriefBatchCounts>
): ContentBriefBatchStatusResponse {
  const counts: ContentBriefBatchCounts = {
    pending: 0,
    generating: 0,
    generated: 0,
    failed: 0,
    missing: 0,
    total: 1,
    ...countOverrides,
  };
  return buildActiveBatch({
    batch_size: counts.total,
    counts,
  });
}

export function buildMissingActiveBatch(
  batchId = 'content-brief-batch-missing'
): ContentBriefBatchStatusResponse {
  return {
    ...buildProgressBatch({
      generated: 1,
      missing: 1,
      total: 2,
    }),
    batch_id: batchId,
  };
}

export async function startMockContentBriefBatch(): Promise<void> {
  await userEvent.click(screen.getByText('Content Brief'));
  await userEvent.click(screen.getByText('Start mock brief batch'));
}
