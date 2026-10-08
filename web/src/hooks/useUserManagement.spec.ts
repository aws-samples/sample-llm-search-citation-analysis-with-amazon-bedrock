import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useUserManagement } from './useUserManagement';
import {
  buildUser, mockUsers, createMockApi, fakeAuthSession, renderLoadedUserManagement 
} from './useUserManagement-fixtures';

const mockApi = createMockApi();

type UserManagementHook = ReturnType<typeof useUserManagement>;

vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: vi.fn() }));

vi.mock('../api/users', () => ({
  USERS_PAGE_LIMIT: 100,
  listUsers: (...args: unknown[]): Promise<unknown> => mockApi.listUsers(...args) as Promise<unknown>,
  inviteUser: (...args: unknown[]): Promise<unknown> => mockApi.inviteUser(...args) as Promise<unknown>,
  updateUser: (...args: unknown[]): Promise<unknown> => mockApi.updateUser(...args) as Promise<unknown>,
  deleteUser: (...args: unknown[]): Promise<unknown> => mockApi.deleteUser(...args) as Promise<unknown>,
  resetUserPassword: (...args: unknown[]): Promise<unknown> => mockApi.resetUserPassword(...args) as Promise<unknown>,
}));

const mockFetchAuthSession = vi.mocked(fetchAuthSession);

/** Makes every later listing hang, so local changes stay visible instead of being replaced by a refresh. */
function stubPendingListing() {
  mockApi.listUsers.mockImplementation(() => new Promise(vi.fn()));
}

describe('useUserManagement', () => {
  beforeEach(() => {
    Object.assign(mockApi, createMockApi());
    mockFetchAuthSession.mockResolvedValue(fakeAuthSession({ email: 'User1@Example.com' }));
  });

  const disableUser2 = (hook: UserManagementHook) => hook.update('user2', { enabled: false });
  const removeUser2 = (hook: UserManagementHook) => hook.remove('user2');
  const resetUser2 = (hook: UserManagementHook) => hook.resetPassword('user2');
  const inviteNewUser = (hook: UserManagementHook) => hook.invite({
    email: 'new@example.com',
    groups: ['Users'],
  });

  describe('loading', () => {
    it('asks for the first page of 100 users on mount', async () => {
      await renderLoadedUserManagement();

      expect(mockApi.listUsers).toHaveBeenCalledWith(100, 0);
    });

    it('follows the pages until the server has no more', async () => {
      Object.assign(mockApi, createMockApi({ pageSize: 1 }));

      const result = await renderLoadedUserManagement();

      expect(result.current.users).toStrictEqual(mockUsers);
      expect(mockApi.listUsers).toHaveBeenCalledWith(100, 1);
    });

    it('sets the total the server reports', async () => {
      const result = await renderLoadedUserManagement();

      expect(result.current.total).toBe(2);
    });

    it('reports the server error when the listing fails', async () => {
      Object.assign(mockApi, createMockApi({ shouldFailList: true }));

      const result = await renderLoadedUserManagement();

      expect(result.current.error).toBe('Failed to list users');
    });

    it('reports "Failed to load users" when the listing rejects with a non-Error', async () => {
      Object.assign(mockApi, createMockApi({ nonErrorRejection: 'offline' }));

      const result = await renderLoadedUserManagement();

      expect(result.current.error).toBe('Failed to load users');
    });

    it('is not refreshing once the first load settles', async () => {
      const result = await renderLoadedUserManagement();

      expect(result.current.refreshing).toBe(false);
    });
  });

  describe('refresh', () => {
    it('keeps the loaded users and reports refreshing, not loading, while a refresh is in flight', async () => {
      const result = await renderLoadedUserManagement();
      stubPendingListing();

      act(() => { void result.current.refresh(); });

      const {
        refreshing, loading, users
      } = result.current;
      expect({
        refreshing,
        loading,
        users,
      }).toStrictEqual({
        refreshing: true,
        loading: false,
        users: mockUsers,
      });
    });
  });

  describe('signed-in identity', () => {
    it('holds the lower-cased identity claims of the ID token', async () => {
      mockFetchAuthSession.mockResolvedValue(fakeAuthSession({
        email: 'Admin@Example.com',
        sub: 'ABC-123',
      }));
      const { result } = renderHook(() => useUserManagement());

      await waitFor(() => expect(result.current.signedInIdentity).toStrictEqual(new Set(['admin@example.com', 'abc-123'])));
    });

    it('is empty when there is no session', async () => {
      mockFetchAuthSession.mockRejectedValue(new TypeError('No session'));

      const result = await renderLoadedUserManagement();

      expect(result.current.signedInIdentity).toStrictEqual(new Set());
    });
  });

  describe('action outcomes', () => {
    it.each<[action: string, run: (hook: UserManagementHook) => Promise<unknown>, outcome: unknown]>([
      ['invite', inviteNewUser, {
        success: true,
        message: 'User invited successfully',
      }],
      ['update', disableUser2, {
        success: true,
        message: undefined,
      }],
      ['delete', removeUser2, {
        success: true,
        message: 'User deleted',
      }],
      ['password reset', resetUser2, {
        success: true,
        message: 'Password reset email sent',
      }],
    ])('answers a successful %s', async (_action, run, outcome) => {
      const result = await renderLoadedUserManagement();

      await expect(act(() => run(result.current))).resolves.toStrictEqual(outcome);
    });

    it('passes the warning of a partly failed invite on', async () => {
      Object.assign(mockApi, createMockApi({ inviteWarning: 'Could not add to Admin' }));
      const result = await renderLoadedUserManagement();

      const outcome = await act(() => inviteNewUser(result.current));

      expect(outcome.warning).toBe('Could not add to Admin');
    });

    it.each<[message: string, failure: Parameters<typeof createMockApi>[0], run: (hook: UserManagementHook) => Promise<unknown>]>([
      ['Failed to invite user', { shouldFailInvite: true }, inviteNewUser],
      ['Failed to update user', { shouldFailUpdate: true }, disableUser2],
      ['Failed to delete user', { shouldFailDelete: true }, removeUser2],
      ['Failed to reset password', { shouldFailReset: true }, resetUser2],
      ['Failed to invite user', { nonErrorRejection: 'offline' }, inviteNewUser],
      ['Failed to update user', { nonErrorRejection: 'offline' }, disableUser2],
      ['Failed to delete user', { nonErrorRejection: 'offline' }, removeUser2],
      ['Failed to reset password', { nonErrorRejection: 'offline' }, resetUser2],
    ])('answers "%s" as an unsuccessful outcome (%j)', async (message, failure, run) => {
      Object.assign(mockApi, createMockApi(failure));
      const result = await renderLoadedUserManagement();

      await expect(act(() => run(result.current))).resolves.toStrictEqual({
        success: false,
        message,
      });
    });

    it('leaves the page error alone when an action fails', async () => {
      Object.assign(mockApi, createMockApi({ shouldFailDelete: true }));
      const result = await renderLoadedUserManagement();

      await act(() => removeUser2(result.current));

      expect(result.current.error).toBeNull();
    });
  });

  describe('local changes before the refresh lands', () => {
    it('replaces the updated user with the server answer', async () => {
      const result = await renderLoadedUserManagement();
      stubPendingListing();

      await act(() => disableUser2(result.current));

      expect(result.current.users[1]).toStrictEqual(buildUser({ enabled: false }));
    });

    it('drops the deleted user', async () => {
      const result = await renderLoadedUserManagement();
      stubPendingListing();

      await act(() => removeUser2(result.current));

      expect(result.current.users.map((user) => user.username)).toStrictEqual(['user1']);
    });
  });

  it.each<[action: string, run: (hook: UserManagementHook) => Promise<unknown>]>([
    ['invite', inviteNewUser],
    ['update', disableUser2],
    ['delete', removeUser2],
    ['password reset', resetUser2],
  ])('reloads the users after a successful %s', async (_action, run) => {
    const result = await renderLoadedUserManagement();
    mockApi.listUsers.mockClear();

    await act(() => run(result.current));

    expect(mockApi.listUsers).toHaveBeenCalledWith(100, 0);
  });
});
