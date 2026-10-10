import {
  describe, expect, it, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { createDeferredValue } from '../test/fetchResponses';
import { TestAbortError } from '../test/abortError';
import { waitForLoaded } from '../test/loadedHook';
import {
  buildRoutesSource,
  mockLoadRoutes,
  NEWER_ROUTES,
  renderFailedRoutes,
  renderLoadedRoutes,
  renderPendingRoutes,
  renderSupersededReload,
  renderTwoReloads,
  RouteListError,
  ROUTES,
  settleRoutes,
} from './useGuardedLoad-fixtures';

describe('useGuardedLoad', () => {
  describe('mount load', () => {
    it('starts loading with the initial value before the mount load lands', async () => {
      const {
        pending, result
      } = renderPendingRoutes();

      expect(result.current).toStrictEqual({
        data: [],
        loading: true,
        settled: false,
        error: null,
        reload: expect.any(Function),
        setData: expect.any(Function),
        mutate: expect.any(Function),
        isMounted: expect.any(Function),
      });
      await settleRoutes(pending, ROUTES);
    });

    it('stores the answer and settles once the mount load lands', async () => {
      const { result } = await renderLoadedRoutes();

      expect(result.current.data).toStrictEqual(ROUTES);
      expect(result.current.settled).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['aborts the load still in flight', () => renderPendingRoutes(), true],
      ['leaves the signal of a settled load alone', () => renderLoadedRoutes(), false],
    ] as const)('%s when the hook unmounts', async (_case, render, aborted) => {
      const { unmount } = await render();
      const [signal] = mockLoadRoutes.mock.calls[0];

      unmount();

      expect(signal.aborted).toBe(aborted);
    });

    it('settles without an error when the current load rejects with an abort', async () => {
      const { result } = await renderFailedRoutes(new TestAbortError());

      expect(result.current.error).toBeNull();
      expect(result.current.settled).toBe(true);
    });

    it('keeps the initial value and reports unmounted when the answer lands after unmount', async () => {
      const {
        pending, result, unmount
      } = renderPendingRoutes();

      unmount();
      await settleRoutes(pending, ROUTES);

      expect(result.current.data).toStrictEqual([]);
      expect(result.current.isMounted()).toBe(false);
    });
  });

  describe('failures', () => {
    it('reports the mapped message and logs the failure under the source message', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const failure = new RouteListError('timed out');

      const { result } = await renderFailedRoutes(failure);

      expect(result.current.error).toBe('Routes unavailable: timed out');
      expect(result.current.data).toStrictEqual([]);
      expect(consoleError).toHaveBeenCalledWith('[routes] Error loading routes:', failure);
    });

    it('logs nothing when the source names no log message', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = await renderFailedRoutes(new RouteListError('timed out'), buildRoutesSource({ logMessage: undefined }));

      expect(result.current.error).toBe('Routes unavailable: timed out');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('clears the error as soon as a reload starts', async () => {
      const { result } = await renderFailedRoutes(new RouteListError('down'), buildRoutesSource({ logMessage: undefined }));
      const pending = createDeferredValue<string[]>();
      mockLoadRoutes.mockReturnValue(pending.promise);

      act(() => {
        void result.current.reload();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
      await settleRoutes(pending, ROUTES);
    });
  });

  describe('reload', () => {
    it('replaces the value with the newer answer', async () => {
      const { result } = await renderLoadedRoutes();
      mockLoadRoutes.mockResolvedValue(NEWER_ROUTES);

      await act(() => result.current.reload());

      expect(result.current.data).toStrictEqual(NEWER_ROUTES);
    });

    it('aborts the load in flight when a reload starts', async () => {
      const { result } = await renderLoadedRoutes();
      const stillLoading = createDeferredValue<string[]>();
      mockLoadRoutes.mockReturnValue(stillLoading.promise);
      act(() => {
        void result.current.reload();
      });
      const [staleSignal] = mockLoadRoutes.mock.calls[1];

      act(() => {
        void result.current.reload();
      });

      expect([staleSignal.aborted, mockLoadRoutes.mock.calls[2][0].aborted]).toStrictEqual([true, false]);
      await settleRoutes(stillLoading, ROUTES);
    });

    it('ignores the answer of a reload a newer one superseded', async () => {
      const {
        result, older, reloads
      } = await renderSupersededReload();

      older.resolve(['stale route']);
      await act(() => reloads);

      expect(result.current.data).toStrictEqual(NEWER_ROUTES);
    });

    it('ignores and does not log a stale failure after a newer reload succeeded', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const {
        result, older, reloads
      } = await renderSupersededReload();

      older.reject(new RouteListError('down'));
      await act(() => reloads);

      expect(result.current.error).toBeNull();
      expect(result.current.data).toStrictEqual(NEWER_ROUTES);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('keeps loading until the newest reload settles', async () => {
      const {
        result, older, newer, reloads
      } = await renderTwoReloads();

      await settleRoutes(older, ROUTES);
      const loadingAfterOlder = result.current.loading;
      newer.resolve(NEWER_ROUTES);
      await act(() => reloads);

      expect(loadingAfterOlder).toBe(true);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('setData', () => {
    it('replaces the value, from the current one when given an updater', async () => {
      const { result } = await renderLoadedRoutes();

      act(() => {
        result.current.setData((current) => [...current, 'Bogotá – Cartagena']);
      });

      expect(result.current.data).toStrictEqual([...ROUTES, 'Bogotá – Cartagena']);
    });
  });

  describe('mutate', () => {
    it('applies and resolves the result while the mutation is the newest operation', async () => {
      const { result } = await renderLoadedRoutes();
      const apply = vi.fn();

      const returned = await act(() => result.current.mutate(() => Promise.resolve('added'), apply));

      expect(returned).toBe('added');
      expect(apply).toHaveBeenCalledWith('added');
    });

    it('drops the answer of a load the mutation superseded and clears loading', async () => {
      const {
        pending, result
      } = renderPendingRoutes();

      await act(() => result.current.mutate(() => Promise.resolve('added'), (added) => {
        result.current.setData([added]);
      }));
      await settleRoutes(pending, ROUTES);

      expect(result.current.data).toStrictEqual(['added']);
      expect(result.current.loading).toBe(false);
    });

    it('skips apply and keeps loading when a reload superseded the mutation', async () => {
      const { result } = await renderLoadedRoutes();
      const request = createDeferredValue<string>();
      const reloading = createDeferredValue<string[]>();
      mockLoadRoutes.mockReturnValue(reloading.promise);
      const apply = vi.fn();
      const mutation = { promise: Promise.resolve('') };
      act(() => {
        mutation.promise = result.current.mutate(() => request.promise, apply);
      });
      act(() => {
        void result.current.reload();
      });

      request.resolve('late');
      await act(() => mutation.promise);

      expect(apply).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(true);
      await settleRoutes(reloading, NEWER_ROUTES);
      await waitForLoaded(result);
    });

    it('rejects as the request did without touching the error state', async () => {
      const { result } = await renderLoadedRoutes();

      await expect(act(() => result.current.mutate(() => Promise.reject(new RouteListError('refused')), vi.fn()))).rejects.toThrow('refused');

      expect(result.current.error).toBeNull();
    });
  });
});
