import { vi } from 'vitest';
import {
  act, renderHook 
} from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import type { AnalysisScope } from '../types';
import { useExecutionPolling } from './useExecutionPolling';

export const mockExecutionArn = 'arn:aws:states:us-east-1:123456789:execution:test';
const mockExecutionName = 'test-execution-123';

/**
 * Points the mocked network layer at `fetch` (the default trigger/status mock
 * unless a spec hands in another) and renders the hook.
 */
function renderExecutionPolling(fetch: ReturnType<typeof createMockFetch> = createMockFetch()) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(() => useExecutionPolling());
}

function createMockTriggerResponse(overrides: Partial<{
  execution_arn: string;
  execution_name: string;
  keywords_count: number;
  error: string;
}> = {}) {
  return {
    execution_arn: overrides.execution_arn ?? mockExecutionArn,
    execution_name: overrides.execution_name ?? mockExecutionName,
    keywords_count: overrides.keywords_count ?? 5,
    ...('error' in overrides ? { error: overrides.error } : {}),
  };
}

export function createMockStatusResponse(status: string, events: unknown[] = [], progress?: unknown) {
  return {
    execution: {
      status,
      start_date: '2024-01-01T00:00:00Z',
      stop_date: status === 'RUNNING' ? undefined : '2024-01-01T00:05:00Z',
    },
    events,
    ...(progress === undefined ? {} : { progress }),
  };
}

/** The status API's keyword `progress` block for a 40-keyword run. */
export const mockKeywordProgress = {
  keywords_total: 40,
  keywords_succeeded: 12,
  keywords_failed: 2,
  keywords_running: 10,
  keywords_pending: 16,
};

/** `renderExecutionPolling(fetch)`, then one `triggerAnalysis(scope)`; `triggerResult` is what it resolved with. */
export async function renderTriggeredExecutionPolling(
  fetch: ReturnType<typeof createMockFetch> = createMockFetch(),
  scope?: AnalysisScope
) {
  const rendered = renderExecutionPolling(fetch);
  const triggerResult = await act(() => rendered.result.current.triggerAnalysis(scope));
  return {
    triggerResult,
    ...rendered,
  };
}

/** Triggers a run whose first status poll carries `progress`, and returns the resulting execution. */
export async function triggerWithProgress(progress: unknown) {
  const { result } = await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse('RUNNING', [], progress) }));
  return result.current.execution;
}

export function createMockFetch(options: {
  triggerSuccess?: boolean;
  triggerResponse?: unknown;
  statusResponse?: unknown;
  statusSequence?: unknown[];
} = {}) {
  const statusCallCount = { current: 0 };

  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/trigger')) {
      if (options.triggerSuccess === false) {
        return Promise.resolve(createMockJsonResponse({ error: 'Trigger failed' }, 500));
      }
      return Promise.resolve(createMockJsonResponse(options.triggerResponse ?? createMockTriggerResponse()));
    }

    if (url.includes('/executions/')) {
      const response = options.statusSequence
        ? options.statusSequence[statusCallCount.current++] ?? options.statusSequence[options.statusSequence.length - 1]
        : options.statusResponse ?? createMockStatusResponse('RUNNING');

      return Promise.resolve(createMockJsonResponse(response));
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
