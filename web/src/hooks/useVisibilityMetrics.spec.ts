import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useVisibilityMetrics } from './useVisibilityMetrics';
import {
  mockVisibilityResponse, createMockFetch 
} from './useVisibilityMetrics-fixtures';

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

const createControlledPromise = () => {
  const promiseControl = { resolvePromise: undefined as ((value: unknown) => void) | undefined };
  const promise = new Promise(resolve => {
    promiseControl.resolvePromise = resolve;
  });
  return {
    promise,
    resolvePromise: promiseControl.resolvePromise 
  };
};

const resolveWithMockResponse = (resolvePromise?: (value: unknown) => void) => {
  resolvePromise?.({
    ok: true,
    json: () => Promise.resolve(mockVisibilityResponse),
  });
};

describe('useVisibilityMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data initially', () => {
      const { result } = renderHook(() => useVisibilityMetrics());

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchVisibilityMetrics', () => {
    it('sets loading true while fetching', async () => {
      const {
        promise, resolvePromise 
      } = createControlledPromise();
      
      mockAuthenticatedFetch.mockImplementation(() => promise);

      const { result } = renderHook(() => useVisibilityMetrics());

      act(() => {
        result.current.fetchVisibilityMetrics('test keyword');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveWithMockResponse(resolvePromise);
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('fetches and returns visibility metrics', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useVisibilityMetrics());

      const fetchResult = await act(async () => {
        return await result.current.fetchVisibilityMetrics('best hotels');
      });

      expect(fetchResult).toStrictEqual(mockVisibilityResponse);
      expect(result.current.data).toStrictEqual(mockVisibilityResponse);
      expect(result.current.error).toBeNull();
    });

    it('includes keyword in URL params', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useVisibilityMetrics());

      await act(async () => {
        await result.current.fetchVisibilityMetrics('best hotels in paris');
      });

      const firstCall = mockAuthenticatedFetch.mock.calls[0];
      expect(firstCall).toBeDefined();
      const url = String(firstCall[0]);
      expect(url).toContain('keyword=best+hotels+in+paris');
    });

    it('includes brand filter in URL params when provided', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useVisibilityMetrics());

      await act(async () => {
        await result.current.fetchVisibilityMetrics('best hotels', 'MyHotel');
      });

      const firstCall = mockAuthenticatedFetch.mock.calls[0];
      expect(firstCall).toBeDefined();
      const url = String(firstCall[0]);
      expect(url).toContain('brand=MyHotel');
    });

    it('sets error when fetch fails', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));

      const { result } = renderHook(() => useVisibilityMetrics());

      const fetchResult = await act(async () => {
        return await result.current.fetchVisibilityMetrics('test');
      });

      expect(fetchResult).toBeNull();
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });

    it('sets error when backend returns error response', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({errorResponse: { error: 'No data available' },}));

      const { result } = renderHook(() => useVisibilityMetrics());

      await act(async () => {
        await result.current.fetchVisibilityMetrics('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets error when response format is invalid', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ invalidResponse: true }));

      const { result } = renderHook(() => useVisibilityMetrics());

      await act(async () => {
        await result.current.fetchVisibilityMetrics('test');
      });

      expect(result.current.error).toBeTruthy();
    });

    it('clears previous error on new fetch', async () => {
      mockAuthenticatedFetch
        .mockImplementationOnce(createMockFetch({ shouldFail: true }))
        .mockImplementationOnce(createMockFetch());

      const { result } = renderHook(() => useVisibilityMetrics());

      await act(async () => {
        await result.current.fetchVisibilityMetrics('test');
      });

      expect(result.current.error).toBeTruthy();

      await act(async () => {
        await result.current.fetchVisibilityMetrics('test');
      });

      expect(result.current.error).toBeNull();
    });

    it('returns fetched data from function', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());

      const { result } = renderHook(() => useVisibilityMetrics());

      const returnedData = await act(async () => {
        return await result.current.fetchVisibilityMetrics('test');
      });

      expect(returnedData).not.toBeNull();
      expect(returnedData?.keyword).toBe('best hotels');
      expect(returnedData?.brands).toHaveLength(2);
    });
  });
});