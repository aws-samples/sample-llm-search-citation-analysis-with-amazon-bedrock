import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import { useIsAdmin } from './useIsAdmin';

class SessionReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionReadError';
  }
}

describe('useIsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('membership resolution', () => {
    it('reports admin when the Admin group is present', async () => {
      const { result } = renderHook(() => useIsAdmin(vi.fn().mockResolvedValue(['Admin'])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(true);
    });

    it('reports admin when Admin appears alongside other groups', async () => {
      const getGroups = vi.fn().mockResolvedValue(['Users', 'Admin']);

      const { result } = renderHook(() => useIsAdmin(getGroups));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(true);
    });

    it('reports non-admin when only the Users group is present', async () => {
      const { result } = renderHook(() => useIsAdmin(vi.fn().mockResolvedValue(['Users'])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
    });

    it('reports non-admin when the user belongs to no groups', async () => {
      const { result } = renderHook(() => useIsAdmin(vi.fn().mockResolvedValue([])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
    });
  });

  describe('exact group matching', () => {
    it('reports non-admin for a group whose name merely contains Admin', async () => {
      const getGroups = vi.fn().mockResolvedValue(['Admins', 'NotAdmin', 'Administrators']);

      const { result } = renderHook(() => useIsAdmin(getGroups));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
    });

    it('reports non-admin for a lowercase variant of the group name', async () => {
      const { result } = renderHook(() => useIsAdmin(vi.fn().mockResolvedValue(['admin'])));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
    });
  });

  describe('failing closed', () => {
    it('reports non-admin while the session is still loading', () => {
      const { result } = renderHook(() => useIsAdmin(vi.fn(() => new Promise<string[]>(vi.fn()))));

      expect(result.current.loading).toBe(true);
      expect(result.current.isAdmin).toBe(false);
    });

    it('reports non-admin when reading the session throws', async () => {
      const getGroups = vi.fn().mockRejectedValue(new SessionReadError('no session'));
      vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = renderHook(() => useIsAdmin(getGroups));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.isAdmin).toBe(false);
    });

    it('stops loading when reading the session throws', async () => {
      /**
       * Leaving `loading` true forever would hide the tab from real admins with
       * no error surfaced anywhere.
       */
      const getGroups = vi.fn().mockRejectedValue(new SessionReadError('no session'));
      vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = renderHook(() => useIsAdmin(getGroups));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(getGroups).toHaveBeenCalledWith();
    });
  });

  describe('cleanup', () => {
    it('aborts the pending session read when unmounted', () => {
      /**
       * The session read outlives a fast unmount, so the state write must be
       * guarded. The abort is the observable half of that guard — a leaked
       * update has no other visible symptom in a test.
       */
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      const getGroups = vi.fn(() => new Promise<string[]>(vi.fn()));

      const { unmount } = renderHook(() => useIsAdmin(getGroups));
      const callsBefore = abortSpy.mock.calls.length;
      unmount();

      expect(abortSpy).toHaveBeenCalledTimes(callsBefore + 1);
      abortSpy.mockRestore();
    });

    it('does not resolve membership after unmount', async () => {
      const deferred: { resolve: (groups: string[]) => void } = { resolve: vi.fn() };
      const getGroups = vi.fn(() => new Promise<string[]>((resolve) => {
        deferred.resolve = resolve;
      }));

      const {
        result, unmount 
      } = renderHook(() => useIsAdmin(getGroups));
      unmount();
      deferred.resolve(['Admin']);
      await Promise.resolve();

      expect(result.current.isAdmin).toBe(false);
    });
  });
});
