import {
  expect, vi 
} from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import type { AuthSession } from 'aws-amplify/auth';
import type { CognitoUser } from '../api/users';
import { ApiRequestError } from '../infrastructure/errors/apiErrors';
import { useUserManagement } from './useUserManagement';

/** A confirmed, enabled Member unless `overrides` say otherwise. */
export function buildUser(overrides: Partial<CognitoUser> = {}): CognitoUser {
  return {
    username: 'user2',
    email: 'user2@example.com',
    email_verified: true,
    status: 'CONFIRMED',
    enabled: true,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    groups: ['Users'],
    ...overrides,
  };
}

/** user1 is an Admin, user2 a Member. */
export const mockUsers: CognitoUser[] = [
  buildUser({
    username: 'user1',
    email: 'user1@example.com',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    groups: ['Users', 'Admin'],
  }),
  buildUser(),
];

interface MockApiOptions {
  users?: CognitoUser[];
  /** Splits the listing into pages of this size, each answered with `has_more` until the last. */
  pageSize?: number;
  shouldFailList?: boolean;
  shouldFailInvite?: boolean;
  shouldFailUpdate?: boolean;
  shouldFailDelete?: boolean;
  shouldFailReset?: boolean;
  /** Present on a successful invite answer. */
  inviteWarning?: string;
  /** Makes every request reject with this non-Error value. */
  nonErrorRejection?: unknown;
}

function failing(fail: boolean | undefined, message: string, answer: () => unknown) {
  return vi.fn().mockImplementation(() => (fail
    ? Promise.reject(new ApiRequestError(message, 400))
    : Promise.resolve(answer())));
}

function listingMock(options: MockApiOptions) {
  const users = options.users ?? mockUsers;
  const pageSize = options.pageSize ?? 100;
  return vi.fn().mockImplementation((_limit: number, offset: number) => {
    if (options.shouldFailList) return Promise.reject(new ApiRequestError('Failed to list users', 500));
    return Promise.resolve({
      users: users.slice(offset, offset + pageSize),
      total: users.length,
      limit: pageSize,
      offset,
      has_more: offset + pageSize < users.length,
    });
  });
}

export function createMockApi(options: MockApiOptions = {}) {
  if (options.nonErrorRejection !== undefined) return createRejectingApi(options.nonErrorRejection);
  return {
    listUsers: listingMock(options),
    inviteUser: failing(options.shouldFailInvite, 'Failed to invite user', () => ({
      user: buildUser({ email: 'new@example.com' }),
      message: 'User invited successfully',
      ...(options.inviteWarning ? { warning: options.inviteWarning } : {}),
    })),
    updateUser: vi.fn().mockImplementation((username: string, request: Partial<CognitoUser>) => (options.shouldFailUpdate
      ? Promise.reject(new ApiRequestError('Failed to update user', 400))
      : Promise.resolve({
        user: buildUser({
          username,
          ...request,
        }),
      }))),
    deleteUser: failing(options.shouldFailDelete, 'Failed to delete user', () => ({ message: 'User deleted' })),
    resetUserPassword: failing(options.shouldFailReset, 'Failed to reset password', () => ({
      message: 'Password reset email sent',
      action: 'password_reset',
    })),
  };
}

/** The user API with every request rejecting with `rejection`. */
function createRejectingApi(rejection: unknown) {
  const rejecting = () => vi.fn().mockImplementation(() => Promise.reject(rejection));
  return {
    listUsers: rejecting(),
    inviteUser: rejecting(),
    updateUser: rejecting(),
    deleteUser: rejecting(),
    resetUserPassword: rejecting(),
  };
}

/** Renders the hook and waits for the initial users load to settle. */
export async function renderLoadedUserManagement() {
  const { result } = renderHook(() => useUserManagement());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

/** An Amplify session whose ID token carries `claims`. */
export function fakeAuthSession(claims: Record<string, string>): AuthSession {
  const token = {
    payload: claims,
    toString: () => 'token',
  };
  return {
    tokens: {
      idToken: token,
      accessToken: token,
    },
  };
}
