import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useExecutionPolling } from './useExecutionPolling';
import {
  mockExecutionArn,
  mockExecutionName,
  createMockStatusResponse,
  createMockFetch,
  renderExecutionPolling,
} from './useExecutionPolling-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


describe('useExecutionPolling', () => {
  it('returns null execution initially', () => {
    const { result } = renderHook(() => useExecutionPolling());

    expect(result.current.execution).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it('resolves a success result naming the keyword count when triggerAnalysis succeeds', async () => {
    const { result } = renderExecutionPolling();

    const triggerResult = await act(() => result.current.triggerAnalysis());

    expect(triggerResult).toStrictEqual({
      success: true,
      message: 'Analysis started with 5 keywords!',
    });
  });

  it('starts monitoring the new execution after triggering analysis', async () => {
    const { result } = renderExecutionPolling();

    await act(() => result.current.triggerAnalysis());

    expect(result.current.execution?.arn).toBe(mockExecutionArn);
    expect(result.current.isRunning).toBe(true);
  });

  it('resolves a failure result carrying the backend error when triggerAnalysis fails', async () => {
    const { result } = renderExecutionPolling(createMockFetch({ triggerSuccess: false }));

    const triggerResult = await act(() => result.current.triggerAnalysis());

    expect(triggerResult).toStrictEqual({
      success: false,
      message: 'Trigger failed',
    });
  });

  it('posts the scope to the keyword-specific endpoint when a scope is provided', async () => {
    const { result } = renderExecutionPolling();

    await act(async () => {
      await result.current.triggerAnalysis({
        mode: 'groups',
        group_ids: ['hotel-coruna'] 
      });
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('https://api.test.com/trigger-keyword-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: {
          mode: 'groups',
          group_ids: ['hotel-coruna'] 
        } 
      }),
    });
  });

  it('posts to the classic all-keywords endpoint with no body when no scope is provided', async () => {
    const { result } = renderExecutionPolling();

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('https://api.test.com/trigger-analysis', { method: 'POST' });
  });

  it.each(['SUCCEEDED', 'FAILED'])('stops running and mirrors the status when the API reports %s', async (status) => {
    const { result } = renderExecutionPolling(createMockFetch({ statusResponse: createMockStatusResponse(status) }));

    await act(() => result.current.triggerAnalysis());

    expect(result.current.execution?.status).toBe(status);
    expect(result.current.isRunning).toBe(false);
  });

  it('starts monitoring existing execution via startMonitoring', async () => {
    const { result } = renderExecutionPolling();

    await act(async () => {
      result.current.startMonitoring(mockExecutionArn, mockExecutionName);
    });

    expect(result.current.execution?.arn).toBe(mockExecutionArn);
    expect(result.current.execution?.name).toBe(mockExecutionName);
    expect(result.current.isRunning).toBe(true);
  });
});

describe('useExecutionPolling polling lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops polling and fires onComplete exactly once after a terminal status', async () => {
    // Regression for AUDIT-2026-08-19 2.16: the interval handle lived in
    // useState, the interval callback froze a stale stopPolling closure over
    // null, clearInterval never ran, and onComplete fired on every 3s tick.
    mockAuthenticatedFetch.mockImplementation(createMockFetch({statusResponse: createMockStatusResponse('SUCCEEDED'),}));
    const onComplete = vi.fn();

    const { result } = renderHook(() => useExecutionPolling(onComplete));

    await act(async () => {
      await result.current.triggerAnalysis();
    });
    const fetchCallsAfterCompletion = mockAuthenticatedFetch.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockAuthenticatedFetch.mock.calls).toHaveLength(fetchCallsAfterCompletion);
  });

  it('keeps polling on the interval while the execution is running', async () => {
    const { result } = renderExecutionPolling(createMockFetch({statusResponse: createMockStatusResponse('RUNNING'),}));

    await act(async () => {
      await result.current.triggerAnalysis();
    });
    const fetchCallsAfterTrigger = mockAuthenticatedFetch.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(mockAuthenticatedFetch.mock.calls).toHaveLength(fetchCallsAfterTrigger + 2);
  });
});
