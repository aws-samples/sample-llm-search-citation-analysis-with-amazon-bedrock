import { act } from '@testing-library/react';
import { vi } from 'vitest';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  readStoredContentStudioBatchCandidates,
  type ContentStudioBatchCandidate,
} from '../api/contentStudioBatchStorage';
import {
  createMockJsonResponse, type DeferredResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { ContentBriefBatchStatusResponse } from '../types';
import type { useContentStudio } from './useContentStudio';
import {
  buildContentHistoryPayload,
  buildMockBatchRequest,
  buildRunningBatchStatusFor,
  buildTerminalBatchStartResponse,
  createMockFetch,
  mockBatchStartResponse,
  mockBatchStatusResponse,
  renderContentStudio,
  storeActiveContentStudioBatchCandidates,
  storeActiveContentStudioBatchIds,
} from './useContentStudio-fixtures';

export const newestTrackedBatchIdsAfterElevenStarts = [
  'batch-11', 'batch-10', 'batch-9', 'batch-8', 'batch-7',
  'batch-6', 'batch-5', 'batch-4', 'batch-3', 'batch-2',
];

export function buildTerminalBatchStatusFor(
  batchId: string
): ContentBriefBatchStatusResponse {
  return {
    ...mockBatchStatusResponse,
    batch_id: batchId,
  };
}

export function renderTwoRunningBatches() {
  storeActiveContentStudioBatchIds(['batch-1', 'batch-2']);
  const fetch = createMockFetch({
    batchStatusResponses: {
      'batch-1': buildRunningBatchStatusFor('batch-1'),
      'batch-2': buildRunningBatchStatusFor('batch-2'),
    },
  });
  return {
    ...renderContentStudio(fetch),
    fetch,
  };
}

export function queueRunningBatchStarts(batchIds: readonly string[]): void {
  for (const batchId of batchIds) {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({
        ...mockBatchStartResponse,
        batch_id: batchId,
      }))
      .mockResolvedValueOnce(createMockJsonResponse(
        buildRunningBatchStatusFor(batchId)
      ));
  }
}

export function queueTerminalBatchStarts(batchIds: readonly string[]): void {
  for (const batchId of batchIds) {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse(
        buildTerminalBatchStartResponse(batchId)
      ))
      .mockResolvedValueOnce(createMockJsonResponse(buildContentHistoryPayload([])));
  }
}

export async function startContentStudioBatches(
  contentStudio: ReturnType<typeof useContentStudio>,
  batchIds: readonly string[]
): Promise<void> {
  for (const batchId of batchIds) {
    await act(() => contentStudio.generateContentBatch(
      buildMockBatchRequest(batchId)
    ));
  }
}

export function dispatchBatchCandidateStorageEvent(
  candidates: readonly ContentStudioBatchCandidate[],
  eventKey: string | null = ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
): void {
  act(() => {
    if (candidates.length === 0) {
      localStorage.removeItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
    } else {
      storeActiveContentStudioBatchCandidates(candidates);
    }
    globalThis.dispatchEvent(new StorageEvent('storage', { key: eventKey }));
  });
}

export function dispatchBatchStorageEvent(
  batchIds: readonly string[],
  eventKey: string | null = ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
): void {
  const existingById = new Map(
    readStoredContentStudioBatchCandidates().map((candidate) => [candidate.id, candidate])
  );
  dispatchBatchCandidateStorageEvent(batchIds.map((batchId) => (
    existingById.get(batchId) ?? {
      id: batchId,
      registeredAt: Date.now(),
    }
  )), eventKey);
}

export async function flushContentStudioPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function resolveRunningBatchStatus(
  request: DeferredResponse,
  batchId: string
): Promise<void> {
  request.resolve(createMockJsonResponse(buildRunningBatchStatusFor(batchId)));
  await flushContentStudioPromises();
}

export async function advanceContentStudioPoll(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
  });
}
