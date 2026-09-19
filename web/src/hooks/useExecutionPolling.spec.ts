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
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useExecutionPolling());

    const triggerResult = await act(() => result.current.triggerAnalysis());

    expect(triggerResult).toStrictEqual({
      success: true,
      message: 'Analysis started with 5 keywords!',
    });
  });

  it('starts monitoring the new execution after triggering analysis', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());
    const { result } = renderHook(() => useExecutionPolling());

    await act(() => result.current.triggerAnalysis());

    expect(result.current.execution?.arn).toBe(mockExecutionArn);
    expect(result.current.isRunning).toBe(true);
  });

  it('resolves a failure result carrying the backend error when triggerAnalysis fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ triggerSuccess: false }));
    const { result } = renderHook(() => useExecutionPolling());

    const triggerResult = await act(() => result.current.triggerAnalysis());

    expect(triggerResult).toStrictEqual({
      success: false,
      message: 'Trigger failed',
    });
  });

  it('posts the scope to the keyword-specific endpoint when a scope is provided', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis({
        mode: 'groups',
        group_ids: ['hotel-coruna'] 
      });
    });

    const triggerCall = mockAuthenticatedFetch.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('/trigger-keyword-analysis')
    );
    expect(triggerCall).toBeDefined();
    const requestInit = triggerCall?.[1] as RequestInit;
    expect(JSON.parse(requestInit.body as string)).toStrictEqual({
      scope: {
        mode: 'groups',
        group_ids: ['hotel-coruna'] 
      } 
    });
  });

  it('uses the classic all-keywords endpoint when no scope is provided', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    const triggerCall = mockAuthenticatedFetch.mock.calls.find(
      (call: unknown[]) => (call[0] as string).endsWith('/trigger-analysis')
    );
    expect(triggerCall).toBeDefined();
  });

  it.each(['SUCCEEDED', 'FAILED'])('stops running and mirrors the status when the API reports %s', async (status) => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ statusResponse: createMockStatusResponse(status) }));
    const { result } = renderHook(() => useExecutionPolling());

    await act(() => result.current.triggerAnalysis());

    expect(result.current.execution?.status).toBe(status);
    expect(result.current.isRunning).toBe(false);
  });

  it('starts monitoring existing execution via startMonitoring', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

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
    mockAuthenticatedFetch.mockImplementation(createMockFetch({statusResponse: createMockStatusResponse('RUNNING'),}));

    const { result } = renderHook(() => useExecutionPolling());

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
