import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsAdmin } from './useIsAdmin';
import { renderResolvedIsAdmin } from './useIsAdmin-fixtures';

class SessionReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionReadError';
  }
}

describe('useIsAdmin', () => {
  describe('membership resolution', () => {
    const membershipCases = [
      {
        outcome: 'admin',
        condition: 'the Admin group is present',
        groups: ['Admin'],
        expectedIsAdmin: true,
      },
      {
        outcome: 'admin',
        condition: 'Admin appears alongside other groups',
        groups: ['Users', 'Admin'],
        expectedIsAdmin: true,
      },
      {
        outcome: 'non-admin',
        condition: 'only the Users group is present',
        groups: ['Users'],
        expectedIsAdmin: false,
      },
      {
        outcome: 'non-admin',
        condition: 'the user belongs to no groups',
        groups: [],
        expectedIsAdmin: false,
      },
    ];

    it.each(membershipCases)('reports $outcome when $condition', async ({
      groups, expectedIsAdmin 
    }) => {
      const { result } = await renderResolvedIsAdmin(vi.fn().mockResolvedValue(groups));

      expect(result.current.isAdmin).toBe(expectedIsAdmin);
    });
  });

  describe('exact group matching', () => {
    const lookalikeCases = [
      {
        condition: 'a group whose name merely contains Admin',
        groups: ['Admins', 'NotAdmin', 'Administrators'],
      },
      {
        condition: 'a lowercase variant of the group name',
        groups: ['admin'],
      },
    ];

    it.each(lookalikeCases)('reports non-admin for $condition', async ({ groups }) => {
      const { result } = await renderResolvedIsAdmin(vi.fn().mockResolvedValue(groups));

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
      vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = await renderResolvedIsAdmin(vi.fn().mockRejectedValue(new SessionReadError('no session')));

      expect(result.current.isAdmin).toBe(false);
    });

    it('stops loading when reading the session throws', async () => {
      /**
       * Leaving `loading` true forever would hide the tab from real admins with
       * no error surfaced anywhere.
       */
      const getGroups = vi.fn().mockRejectedValue(new SessionReadError('no session'));
      vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = await renderResolvedIsAdmin(getGroups);

      expect(result.current.loading).toBe(false);
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
