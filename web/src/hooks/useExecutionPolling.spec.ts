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

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = authenticatedFetch as ReturnType<typeof vi.fn>;

describe('useExecutionPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null execution initially', () => {
    const { result } = renderHook(() => useExecutionPolling());

    expect(result.current.execution).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  it('returns success result when triggerAnalysis succeeds', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

    const triggerResult = {
      success: false,
      message: '' 
    };
    await act(async () => {
      const res = await result.current.triggerAnalysis();
      triggerResult.success = res.success;
      triggerResult.message = res.message;
    });

    expect(triggerResult.success).toBe(true);
    expect(triggerResult.message).toContain('5 keywords');
  });

  it('sets execution state after triggering analysis', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    expect(result.current.execution).not.toBeNull();
    expect(result.current.execution?.arn).toBe(mockExecutionArn);
    expect(result.current.isRunning).toBe(true);
  });

  it('returns failure result when triggerAnalysis fails', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({ triggerSuccess: false }));

    const { result } = renderHook(() => useExecutionPolling());

    const triggerResult = {
      success: true,
      message: '' 
    };
    await act(async () => {
      const res = await result.current.triggerAnalysis();
      triggerResult.success = res.success;
      triggerResult.message = res.message;
    });

    expect(triggerResult.success).toBe(false);
    expect(triggerResult.message).toBeTruthy();
  });

  it('uses keyword-specific endpoint when keywords provided', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch());

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis(['keyword1', 'keyword2']);
    });

    const triggerCall = mockAuthenticatedFetch.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('/trigger-keyword-analysis')
    );
    expect(triggerCall).toBeDefined();
  });

  it('sets execution status to SUCCEEDED when API returns SUCCEEDED', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({statusResponse: createMockStatusResponse('SUCCEEDED'),}));

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    expect(result.current.execution?.status).toBe('SUCCEEDED');
    expect(result.current.isRunning).toBe(false);
  });

  it('sets execution status to FAILED when API returns FAILED', async () => {
    mockAuthenticatedFetch.mockImplementation(createMockFetch({statusResponse: createMockStatusResponse('FAILED'),}));

    const { result } = renderHook(() => useExecutionPolling());

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    expect(result.current.execution?.status).toBe('FAILED');
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
