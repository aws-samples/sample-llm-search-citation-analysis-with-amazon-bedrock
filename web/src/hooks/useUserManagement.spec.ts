import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useUserManagement } from './useUserManagement';
import {
  mockUsers, mockGroups, createMockApi 
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

const waitForHookReady = async (result: { current: { loading: boolean } }): Promise<void> => {
  await waitFor(() => expect(result.current.loading).toBe(false));
};

describe('useUserManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockApi, createMockApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches users and groups on mount', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(mockApi.listUsers).toHaveBeenCalledTimes(1);
    expect(mockApi.listGroups).toHaveBeenCalledTimes(1);
  });

  it('sets users from API response', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(result.current.users).toStrictEqual(mockUsers);
  });

  it('sets groups from API response', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(result.current.groups).toStrictEqual(mockGroups);
  });

  it('sets total from API response', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(result.current.total).toBe(2);
  });

  it('sets hasMore based on total vs users length', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(result.current.hasMore).toBe(false);
  });

  it('sets error when fetch fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailList: true }));
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    expect(result.current.error).toBeTruthy();
  });

  it('returns success when invite succeeds', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const inviteResult: {
      success: boolean;
      message?: string 
    } = { success: false };
    await act(async (): Promise<void> => {
      Object.assign(inviteResult, await result.current.invite({
        email: 'new@example.com',
        groups: ['Users'],
      }));
    });

    expect(inviteResult.success).toBe(true);
    expect(inviteResult.message).toBe('User invited successfully');
  });

  it('refreshes users after successful invite', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const initialCallCount = mockApi.listUsers.mock.calls.length;

    await act(async (): Promise<void> => {
      await result.current.invite({
        email: 'new@example.com',
        groups: [] 
      });
    });

    expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('returns failure when invite fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailInvite: true }));
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const inviteResult: {
      success: boolean;
      message?: string 
    } = { success: true };
    await act(async (): Promise<void> => {
      Object.assign(inviteResult, await result.current.invite({
        email: 'new@example.com',
        groups: [] 
      }));
    });

    expect(inviteResult.success).toBe(false);
    expect(inviteResult.message).toBeTruthy();
  });

  it('returns true when update succeeds', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const updateResult = { value: false };
    await act(async (): Promise<void> => {
      updateResult.value = await result.current.update('user1', { enabled: false });
    });

    expect(updateResult.value).toBe(true);
  });

  it('refreshes users after successful update', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const initialCallCount = mockApi.listUsers.mock.calls.length;

    await act(async (): Promise<void> => {
      await result.current.update('user1', { enabled: false });
    });

    expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('returns false and sets error when update fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailUpdate: true }));
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const updateResult = { value: true };
    await act(async (): Promise<void> => {
      updateResult.value = await result.current.update('user1', { enabled: false });
    });

    expect(updateResult.value).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('returns true when delete succeeds', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const removeResult = { value: false };
    await act(async (): Promise<void> => {
      removeResult.value = await result.current.remove('user1');
    });

    expect(removeResult.value).toBe(true);
  });

  it('refreshes users after successful delete', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const initialCallCount = mockApi.listUsers.mock.calls.length;

    await act(async (): Promise<void> => {
      await result.current.remove('user1');
    });

    expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('returns false and sets error when delete fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailDelete: true }));
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const removeResult = { value: true };
    await act(async (): Promise<void> => {
      removeResult.value = await result.current.remove('user1');
    });

    expect(removeResult.value).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('returns success when reset succeeds', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const resetResult: {
      success: boolean;
      message?: string 
    } = { success: false };
    await act(async (): Promise<void> => {
      Object.assign(resetResult, await result.current.resetPassword('user1'));
    });

    expect(resetResult.success).toBe(true);
    expect(resetResult.message).toBe('Password reset email sent');
  });

  it('returns failure when reset fails', async (): Promise<void> => {
    Object.assign(mockApi, createMockApi({ shouldFailReset: true }));
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const resetResult: {
      success: boolean;
      message?: string 
    } = { success: true };
    await act(async (): Promise<void> => {
      Object.assign(resetResult, await result.current.resetPassword('user1'));
    });

    expect(resetResult.success).toBe(false);
    expect(resetResult.message).toBeTruthy();
  });

  it('refetches users and groups', async (): Promise<void> => {
    const { result } = renderHook(() => useUserManagement());
    await waitForHookReady(result);

    const initialUserCalls = mockApi.listUsers.mock.calls.length;
    const initialGroupCalls = mockApi.listGroups.mock.calls.length;

    await act(async (): Promise<void> => {
      await result.current.refresh();
    });

    expect(mockApi.listUsers.mock.calls.length).toBeGreaterThan(initialUserCalls);
    expect(mockApi.listGroups.mock.calls.length).toBeGreaterThan(initialGroupCalls);
  });
});
