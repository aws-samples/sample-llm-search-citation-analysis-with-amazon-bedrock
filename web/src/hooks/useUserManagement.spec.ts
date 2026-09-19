import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { act } from '@testing-library/react';
import type { useUserManagement } from './useUserManagement';
import {
  mockUsers, mockGroups, createMockApi, renderLoadedUserManagement 
} from './useUserManagement-fixtures';

const mockApi = createMockApi();

vi.mock('../api/users', () => ({
  listUsers: (...args: unknown[]): Promise<unknown> => mockApi.listUsers(...args) as Promise<unknown>,
  listGroups: (...args: unknown[]): Promise<unknown> => mockApi.listGroups(...args) as Promise<unknown>,
  inviteUser: (...args: unknown[]): Promise<unknown> => mockApi.inviteUser(...args) as Promise<unknown>,
  updateUser: (...args: unknown[]): Promise<unknown> => mockApi.updateUser(...args) as Promise<unknown>,
  deleteUser: (...args: unknown[]): Promise<unknown> => mockApi.deleteUser(...args) as Promise<unknown>,
  resetUserPassword: (...args: unknown[]): Promise<unknown> => mockApi.resetUserPassword(...args) as Promise<unknown>,
}));

describe('useUserManagement', () => {
  beforeEach(() => {
    Object.assign(mockApi, createMockApi());
  });

  it('fetches users and groups on mount', async (): Promise<void> => {
    await renderLoadedUserManagement();

    expect(mockApi.listUsers).toHaveBeenCalledTimes(1);
    expect(mockApi.listGroups).toHaveBeenCalledTimes(1);
  });

  it('sets users from API response', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    expect(result.current.users).toStrictEqual(mockUsers);
  });

  it('sets groups from API response', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    expect(result.current.groups).toStrictEqual(mockGroups);
  });

  it('sets total from API response', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    expect(result.current.total).toBe(2);
  });

  it('sets hasMore based on total vs users length', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    expect(result.current.hasMore).toBe(false);
  });

  it('sets error when fetch fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailList: true }));
    const result = await renderLoadedUserManagement();

    expect(result.current.error).toBe('Failed to list users');
  });

  it('returns success when invite succeeds', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    const invited = await act(() => result.current.invite({
      email: 'new@example.com',
      groups: ['Users'],
    }));

    expect(invited).toStrictEqual({
      success: true,
      message: 'User invited successfully' 
    });
  });

  describe('list refresh after a successful mutation', () => {
    interface RefreshingMutation {
      mutation: string;
      run: (hook: ReturnType<typeof useUserManagement>) => Promise<unknown>;
    }

    const refreshingMutations: RefreshingMutation[] = [
      {
        mutation: 'invite',
        run: (hook) => hook.invite({
          email: 'new@example.com',
          groups: [] 
        }),
      },
      {
        mutation: 'update',
        run: (hook) => hook.update('user1', { enabled: false }),
      },
      {
        mutation: 'delete',
        run: (hook) => hook.remove('user1'),
      },
    ];

    it.each(refreshingMutations)('refreshes users after successful $mutation', async ({ run }) => {
      const result = await renderLoadedUserManagement();
      const initialCallCount = mockApi.listUsers.mock.calls.length;

      await act(() => run(result.current));

      expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('returns failure when invite fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailInvite: true }));
    const result = await renderLoadedUserManagement();

    const invited = await act(() => result.current.invite({
      email: 'new@example.com',
      groups: [] 
    }));

    expect(invited).toStrictEqual({
      success: false,
      message: 'Failed to invite user' 
    });
  });

  it('returns true when update succeeds', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    const updated = await act(() => result.current.update('user1', { enabled: false }));

    expect(updated).toBe(true);
  });

  it('returns false and sets error when update fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailUpdate: true }));
    const result = await renderLoadedUserManagement();

    const updated = await act(() => result.current.update('user1', { enabled: false }));

    expect(updated).toBe(false);
    expect(result.current.error).toBe('Failed to update user');
  });

  it('returns true when delete succeeds', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    const removed = await act(() => result.current.remove('user1'));

    expect(removed).toBe(true);
  });

  it('returns false and sets error when delete fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailDelete: true }));
    const result = await renderLoadedUserManagement();

    const removed = await act(() => result.current.remove('user1'));

    expect(removed).toBe(false);
    expect(result.current.error).toBe('Failed to delete user');
  });

  it('returns success when reset succeeds', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    const reset = await act(() => result.current.resetPassword('user1'));

    expect(reset).toStrictEqual({
      success: true,
      message: 'Password reset email sent' 
    });
  });

  it('returns failure when reset fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailReset: true }));
    const result = await renderLoadedUserManagement();

    const reset = await act(() => result.current.resetPassword('user1'));

    expect(reset).toStrictEqual({
      success: false,
      message: 'Failed to reset password' 
    });
  });

  it('refetches users and groups', async (): Promise<void> => {
    const result = await renderLoadedUserManagement();

    const initialUserCalls = mockApi.listUsers.mock.calls.length;
    const initialGroupCalls = mockApi.listGroups.mock.calls.length;

    await act(async (): Promise<void> => {
      await result.current.refresh();
    });

    expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialUserCalls);
    expect(mockApi.listGroups.mock.calls.length).toBeGreaterThan(initialGroupCalls);
  });
});
