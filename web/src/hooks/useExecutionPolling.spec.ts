import {
  afterEach, describe, it, expect, vi
} from 'vitest';
import {
  renderHook, act, waitFor
} from '@testing-library/react';
import { useExecutionPolling } from './useExecutionPolling';
import type { AnalysisScope } from '../types';
import {
  mockExecutionArn,
  createMockStatusResponse,
  createMockFetch,
  renderTriggeredExecutionPolling,
  mockKeywordProgress,
  statusReads,
  triggerWithProgress,
} from './useExecutionPolling-fixtures';

import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


describe('useExecutionPolling', () => {
  it('returns null execution initially', () => {
    const { result } = renderHook(() => useExecutionPolling());

    expect(result.current.execution).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it.each([
    {
      name: 'resolves a success result naming the keyword count when triggerAnalysis succeeds',
      fetch: createMockFetch(),
      expected: {
        success: true,
        message: 'Analysis started with 5 keywords!',
      },
    },
    {
      name: 'resolves a failure result carrying the backend error when triggerAnalysis fails',
      fetch: createMockFetch({ triggerSuccess: false }),
      expected: {
        success: false,
        message: 'Trigger failed',
      },
    },
  ])('$name', async ({
    fetch, expected 
  }) => {
    const { triggerResult } = await renderTriggeredExecutionPolling(fetch);

    expect(triggerResult).toStrictEqual(expected);
  });

  it('starts monitoring the new execution after triggering analysis', async () => {
    const { result } = await renderTriggeredExecutionPolling();

    expect(result.current.execution?.arn).toBe(mockExecutionArn);
    expect(result.current.isRunning).toBe(true);
  });

  it.each([
    {
      name: 'posts the scope to the keyword-specific endpoint when a scope is provided',
      scope: {
        mode: 'groups',
        group_ids: ['hotel-coruna']
      } satisfies AnalysisScope,
      url: 'https://api.test.com/trigger-keyword-analysis',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: {
            mode: 'groups',
            group_ids: ['hotel-coruna']
          }
        }),
      },
    },
    {
      name: 'posts to the classic all-keywords endpoint with no body when no scope is provided',
      scope: undefined,
      url: 'https://api.test.com/trigger-analysis',
      init: { method: 'POST' },
    },
  ])('$name', async ({
    scope, url, init 
  }) => {
    await renderTriggeredExecutionPolling(createMockFetch(), scope);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, init);
  });

  it.each(['SUCCEEDED', 'FAILED'])('stops running and mirrors the status when the API reports %s', async (status) => {
    const { result } = await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse(status) }));

    expect(result.current.execution?.status).toBe(status);
    expect(result.current.isRunning).toBe(false);
  });
});

describe('useExecutionPolling keyword progress', () => {
  it('carries the keyword progress of the status response into the execution', async () => {
    const execution = await triggerWithProgress(mockKeywordProgress);

    expect(execution?.progress).toStrictEqual(mockKeywordProgress);
  });

  it('decodes keyword counts sent as digit strings into numbers', async () => {
    const execution = await triggerWithProgress({
      ...mockKeywordProgress,
      keywords_total: '40',
      keywords_failed: '2' 
    });

    expect(execution?.progress).toStrictEqual(mockKeywordProgress);
  });

  it.each([
    ['absent', undefined],
    ['null (no map run yet)', null],
    ['missing a count', {
      ...mockKeywordProgress,
      keywords_pending: undefined 
    }],
    ['carrying a negative count', {
      ...mockKeywordProgress,
      keywords_running: -1 
    }],
    ['carrying a fractional count', {
      ...mockKeywordProgress,
      keywords_total: 40.5 
    }],
    ['carrying a non-numeric string', {
      ...mockKeywordProgress,
      keywords_succeeded: 'twelve' 
    }],
    ['not an object', 'forty'],
  ])('sets progress to null when the status progress is %s', async (_label, progress) => {
    const execution = await triggerWithProgress(progress);

    expect(execution?.progress).toBeNull();
  });
});

describe('useExecutionPolling live lifecycle', () => {
  afterEach(() => {
    resetLiveEvents();
  });

  it('fires onComplete exactly once after a terminal status and listens to nothing more', async () => {
    // Regression for AUDIT-2026-08-19 2.16: onComplete fired on every 3s tick of the old poll.
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ statusResponse: createMockStatusResponse('SUCCEEDED') }));
    const onComplete = vi.fn();
    const { result } = renderHook(() => useExecutionPolling(onComplete));

    await act(async () => {
      await result.current.triggerAnalysis();
    });
    await emitLive('runs', {
      type: 'execution.status',
      executionArn: mockExecutionArn,
      status: 'SUCCEEDED' 
    });

    expect([onComplete.mock.calls.length, liveSubscriberCount('runs')]).toStrictEqual([1, 0]);
  });

  it('reads the status once to catch up when it starts listening to a running execution', async () => {
    await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse('RUNNING') }));

    await waitFor(() => {
      expect(statusReads()).toBe(2);
    });
  });

  it.each([
    ['its own status change', {
      type: 'execution.status',
      executionArn: mockExecutionArn,
      status: 'RUNNING' 
    }],
    ['one of its steps', {
      type: 'run.step.finished',
      execution_id: 'test',
      step: 'generate_summary' 
    }],
    ['a keyword finishing', {
      type: 'run.keyword.finished',
      status: 'success' 
    }],
  ])('reads the status again on %s', async (_case, event) => {
    await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse('RUNNING') }));
    await waitFor(() => {
      expect(statusReads()).toBe(2);
    });

    await emitLive('runs', event);

    await waitFor(() => {
      expect(statusReads()).toBe(3);
    });
  });

  it('ignores another execution’s status change', async () => {
    await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse('RUNNING') }));
    await waitFor(() => {
      expect(statusReads()).toBe(2);
    });

    await emitLive('runs', {
      type: 'execution.status',
      executionArn: `${mockExecutionArn}-other`,
      status: 'SUCCEEDED' 
    });

    expect(statusReads()).toBe(2);
  });

  it('stops listening when the hook unmounts', async () => {
    const { unmount } = await renderTriggeredExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse('RUNNING') }));
    unmount();

    expect(liveSubscriberCount('runs')).toBe(0);
  });
});
