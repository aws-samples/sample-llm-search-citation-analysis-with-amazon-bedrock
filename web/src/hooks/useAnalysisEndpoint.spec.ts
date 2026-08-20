import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';
import {
  buildProbeEndpoint,
  createMockFetch,
  createDeferredMockFetch,
  probeResponse,
  newerProbeResponse,
  ProbeRequestError,
  type ProbeResponse,
} from './useAnalysisEndpoint-fixtures';

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

describe('useAnalysisEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns null data, loading false, and null error before any fetch', () => {
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchData', () => {
    it('stores and resolves the payload when the response passes the type guard', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      const holder: { value: ProbeResponse | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.fetchData('best hotels');
      });

      expect(holder.value).toStrictEqual(probeResponse);
      expect(result.current.data).toStrictEqual(probeResponse);
      expect(result.current.error).toBeNull();
    });

    it('requests the built path and params against the API base URL', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      await act(async () => {
        await result.current.fetchData('best hotels');
      });

      const url = mockAuthenticatedFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://api.test.com/probe?keyword=best+hotels');
    });

    it('passes an abort signal to authenticatedFetch', () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      act(() => {
        result.current.fetchData('best hotels');
      });

      expect(deferred.requests[0].signal).toBeInstanceOf(AbortSignal);
    });

    it('sets the error state and resolves null when the response status is not ok', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ shouldFail: true }));
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      const holder: { value: ProbeResponse | null } = { value: probeResponse };
      await act(async () => {
        holder.value = await result.current.fetchData('best hotels');
      });

      expect(holder.value).toBeNull();
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });

    it('surfaces the backend {error} body message through the response error factory', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ response: { error: 'probe quota exceeded' } }));
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      await act(async () => {
        await result.current.fetchData('best hotels');
      });

      const logged = consoleErrorSpy.mock.calls[0][1] as Error;
      expect(logged).toBeInstanceOf(ProbeRequestError);
      expect(logged.message).toBe('probe quota exceeded');
      expect(result.current.error).toBeTruthy();
      consoleErrorSpy.mockRestore();
    });

    it('reports the invalid-format failure when the payload fails the type guard', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockAuthenticatedFetch.mockImplementation(createMockFetch({ response: { unrelated: true } }));
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      await act(async () => {
        await result.current.fetchData('best hotels');
      });

      const logged = consoleErrorSpy.mock.calls[0][1] as Error;
      expect(logged.message).toBe('Invalid response format');
      expect(result.current.error).toBeTruthy();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('concurrent fetches', () => {
    it('aborts the previous in-flight request when a new fetch starts', () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      act(() => {
        result.current.fetchData('first');
      });
      act(() => {
        result.current.fetchData('second');
      });

      expect(deferred.requests[0].signal?.aborted).toBe(true);
      expect(deferred.requests[1].signal?.aborted).toBe(false);
    });

    it('resolves null for the aborted fetch and leaves the error state null', async () => {
      const deferred = createDeferredMockFetch({ rejectOnAbort: true });
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      const aborted: { promise: Promise<ProbeResponse | null> | null } = { promise: null };
      act(() => {
        aborted.promise = result.current.fetchData('first');
      });
      act(() => {
        result.current.fetchData('second');
      });
      await act(async () => {
        deferred.requests[1].respond(probeResponse);
      });

      await expect(aborted.promise).resolves.toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.data).toStrictEqual(probeResponse);
    });

    it('ignores a stale response that resolves after a newer request', async () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      const stale: { promise: Promise<ProbeResponse | null> | null } = { promise: null };
      act(() => {
        stale.promise = result.current.fetchData('first');
      });
      act(() => {
        result.current.fetchData('second');
      });
      await act(async () => {
        deferred.requests[1].respond(newerProbeResponse);
      });
      await act(async () => {
        deferred.requests[0].respond(probeResponse);
      });

      await expect(stale.promise).resolves.toBeNull();
      expect(result.current.data).toStrictEqual(newerProbeResponse);
    });

    it('keeps loading set until the current request settles', async () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      act(() => {
        result.current.fetchData('first');
      });
      act(() => {
        result.current.fetchData('second');
      });

      await act(async () => {
        deferred.requests[0].respond(probeResponse);
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.requests[1].respond(newerProbeResponse);
      });
      expect(result.current.loading).toBe(false);
    });
  });

  describe('unmount', () => {
    it('aborts the active request when the component unmounts', () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const {
        result, unmount 
      } = renderHook(() => useAnalysisEndpoint(config));

      act(() => {
        result.current.fetchData('best hotels');
      });
      unmount();

      expect(deferred.requests[0].signal?.aborted).toBe(true);
    });
  });

  describe('runRequest', () => {
    it('leaves stored data untouched when a secondary request resolves', async () => {
      mockAuthenticatedFetch.mockImplementation(createMockFetch());
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      const holder: { value: ProbeResponse | null } = { value: null };
      await act(async () => {
        holder.value = await result.current.runRequest({
          path: '/probe',
          params: new URLSearchParams({ keyword: 'secondary' }),
        }, config);
      });

      expect(holder.value).toStrictEqual(probeResponse);
      expect(result.current.data).toBeNull();
    });

    it('aborts an in-flight secondary request when a new fetch starts', () => {
      const deferred = createDeferredMockFetch();
      mockAuthenticatedFetch.mockImplementation(deferred.impl);
      const config = buildProbeEndpoint();
      const { result } = renderHook(() => useAnalysisEndpoint(config));

      act(() => {
        result.current.runRequest({ path: '/probe' }, config);
      });
      act(() => {
        result.current.fetchData('next');
      });

      expect(deferred.requests[0].signal?.aborted).toBe(true);
    });
  });
});
