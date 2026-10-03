import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import { act } from '@testing-library/react';
import type { useUserManagement } from './useUserManagement';
import {
  mockUsers, mockGroups, createMockApi, renderLoadedUserManagement 
} from './useUserManagement-fixtures';

const mockApi = createMockApi();

type UserManagementHook = ReturnType<typeof useUserManagement>;

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

  const inviteNewUser = (hook: UserManagementHook) => hook.invite({
    email: 'new@example.com',
    groups: [],
  });
  const updateUser1 = (hook: UserManagementHook) => hook.update('user1', { enabled: false });
  const removeUser1 = (hook: UserManagementHook) => hook.remove('user1');
  const resetUser1 = (hook: UserManagementHook) => hook.resetPassword('user1');

  it('fetches users and groups on mount', async (): Promise<void> => {
    await renderLoadedUserManagement();

    expect(mockApi.listUsers).toHaveBeenCalledTimes(1);
    expect(mockApi.listGroups).toHaveBeenCalledTimes(1);
  });

  describe('loaded state', () => {
    interface LoadedField {
      testName: string;
      read: (hook: UserManagementHook) => unknown;
      expected: unknown;
    }

    const loadedFields: LoadedField[] = [
      {
        testName: 'sets users from API response',
        read: (hook) => hook.users,
        expected: mockUsers,
      },
      {
        testName: 'sets groups from API response',
        read: (hook) => hook.groups,
        expected: mockGroups,
      },
      {
        testName: 'sets total from API response',
        read: (hook) => hook.total,
        expected: 2,
      },
      {
        testName: 'sets hasMore based on total vs users length',
        read: (hook) => hook.hasMore,
        expected: false,
      },
    ];

    it.each(loadedFields)('$testName', async ({
      read, expected
    }) => {
      const result = await renderLoadedUserManagement();

      expect(read(result.current)).toStrictEqual(expected);
    });
  });

  it('sets error when fetch fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailList: true }));
    const result = await renderLoadedUserManagement();

    expect(result.current.error).toBe('Failed to list users');
  });

  describe('list refresh after a successful mutation', () => {
    interface RefreshingMutation {
      mutation: string;
      run: (hook: UserManagementHook) => Promise<unknown>;
    }

    const refreshingMutations: RefreshingMutation[] = [
      {
        mutation: 'invite',
        run: inviteNewUser,
      },
      {
        mutation: 'update',
        run: updateUser1,
      },
      {
        mutation: 'delete',
        run: removeUser1,
      },
    ];

    it.each(refreshingMutations)('refreshes users after successful $mutation', async ({ run }) => {
      const result = await renderLoadedUserManagement();
      const initialCallCount = mockApi.listUsers.mock.calls.length;

      await act(() => run(result.current));

      expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('mutation outcomes', () => {
    type MockApiFailure = Parameters<typeof createMockApi>[0];

    interface MutationOutcome {
      testName: string;
      failure: MockApiFailure;
      run: (hook: UserManagementHook) => Promise<unknown>;
      expected: unknown;
    }

    interface FailedMutationError {
      testName: string;
      failure: MockApiFailure;
      run: (hook: UserManagementHook) => Promise<unknown>;
      expectedError: string;
    }

    const mutationOutcomes: MutationOutcome[] = [
      {
        testName: 'returns success when invite succeeds',
        failure: {},
        run: (hook) => hook.invite({
          email: 'new@example.com',
          groups: ['Users'],
        }),
        expected: {
          success: true,
          message: 'User invited successfully',
        },
      },
      {
        testName: 'returns failure when invite fails',
        failure: { shouldFailInvite: true },
        run: inviteNewUser,
        expected: {
          success: false,
          message: 'Failed to invite user',
        },
      },
      {
        testName: 'returns true when update succeeds',
        failure: {},
        run: updateUser1,
        expected: true,
      },
      {
        testName: 'returns true when delete succeeds',
        failure: {},
        run: removeUser1,
        expected: true,
      },
      {
        testName: 'returns success when reset succeeds',
        failure: {},
        run: resetUser1,
        expected: {
          success: true,
          message: 'Password reset email sent',
        },
      },
      {
        testName: 'returns failure when reset fails',
        failure: { shouldFailReset: true },
        run: resetUser1,
        expected: {
          success: false,
          message: 'Failed to reset password',
        },
      },
    ];

    const failedMutationErrors: FailedMutationError[] = [
      {
        testName: 'returns false and sets error when update fails',
        failure: { shouldFailUpdate: true },
        run: updateUser1,
        expectedError: 'Failed to update user',
      },
      {
        testName: 'returns false and sets error when delete fails',
        failure: { shouldFailDelete: true },
        run: removeUser1,
        expectedError: 'Failed to delete user',
      },
    ];

    async function renderAfterMutation(
      failure: MockApiFailure,
      run: (hook: UserManagementHook) => Promise<unknown>
    ) {
      Object.assign(mockApi, createMockApi(failure));
      const result = await renderLoadedUserManagement();
      const outcome = await act(() => run(result.current));
      return {
        result,
        outcome,
      };
    }

    it.each(mutationOutcomes)('$testName', async ({
      failure, run, expected
    }) => {
      const { outcome } = await renderAfterMutation(failure, run);

      expect(outcome).toStrictEqual(expected);
    });

    it.each(failedMutationErrors)('$testName', async ({
      failure, run, expectedError
    }) => {
      const {
        result, outcome
      } = await renderAfterMutation(failure, run);

      expect(outcome).toBe(false);
      expect(result.current.error).toBe(expectedError);
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
