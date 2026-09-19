import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useExecutionPolling } from './useExecutionPolling';

export const mockExecutionArn = 'arn:aws:states:us-east-1:123456789:execution:test';
export const mockExecutionName = 'test-execution-123';

/**
 * Points the mocked network layer at `fetch` (the default trigger/status mock
 * unless a spec hands in another) and renders the hook.
 */
export function renderExecutionPolling(fetch: ReturnType<typeof createMockFetch> = createMockFetch()) {
  mockAuthenticatedFetch.mockImplementation(fetch);
  return renderHook(() => useExecutionPolling());
}

export function createMockTriggerResponse(overrides: Partial<{
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

export function createMockStatusResponse(status: string, events: unknown[] = []) {
  return {
    execution: {
      status,
      start_date: '2024-01-01T00:00:00Z',
      stop_date: status === 'RUNNING' ? undefined : '2024-01-01T00:05:00Z',
    },
    events,
  };
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
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Trigger failed' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.triggerResponse ?? createMockTriggerResponse()),
      });
    }

    if (url.includes('/executions/')) {
      const response = options.statusSequence
        ? options.statusSequence[statusCallCount.current++] ?? options.statusSequence[options.statusSequence.length - 1]
        : options.statusResponse ?? createMockStatusResponse('RUNNING');

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
