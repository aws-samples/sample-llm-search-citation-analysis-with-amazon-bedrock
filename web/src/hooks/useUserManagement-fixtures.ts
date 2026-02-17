import { vi } from 'vitest';
import type {
  CognitoUser, UserGroup 
} from '../api/users';
import { ApiRequestError } from '../infrastructure/errors/apiErrors';

export const mockUsers: CognitoUser[] = [
  {
    username: 'user1',
    email: 'user1@example.com',
    email_verified: true,
    status: 'CONFIRMED',
    enabled: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    groups: ['Admins'],
  },
  {
    username: 'user2',
    email: 'user2@example.com',
    email_verified: true,
    status: 'CONFIRMED',
    enabled: true,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    groups: ['Users'],
  },
];

export const mockGroups: UserGroup[] = [
  {
    name: 'Admins',
    description: 'Administrator group',
    precedence: 1
  },
  {
    name: 'Users',
    description: 'Regular users',
    precedence: 2
  },
];

export function createMockApi(options: {
  users?: CognitoUser[];
  groups?: UserGroup[];
  shouldFailList?: boolean;
  shouldFailInvite?: boolean;
  shouldFailUpdate?: boolean;
  shouldFailDelete?: boolean;
  shouldFailReset?: boolean;
} = {}) {
  return {
    listUsers: vi.fn().mockImplementation(() => {
      if (options.shouldFailList) {
        return Promise.reject(new ApiRequestError('Failed to list users', 500));
      }
      return Promise.resolve({
        users: options.users ?? mockUsers,
        total: (options.users ?? mockUsers).length,
        has_more: false,
      });
    }),
    listGroups: vi.fn().mockImplementation(() => {
      if (options.shouldFailList) {
        return Promise.reject(new ApiRequestError('Failed to list groups', 500));
      }
      return Promise.resolve({ groups: options.groups ?? mockGroups });
    }),
    inviteUser: vi.fn().mockImplementation(() => {
      if (options.shouldFailInvite) {
        return Promise.reject(new ApiRequestError('Failed to invite user', 400));
      }
      return Promise.resolve({ message: 'User invited successfully' });
    }),
    updateUser: vi.fn().mockImplementation(() => {
      if (options.shouldFailUpdate) {
        return Promise.reject(new ApiRequestError('Failed to update user', 400));
      }
      return Promise.resolve({ success: true });
    }),
    deleteUser: vi.fn().mockImplementation(() => {
      if (options.shouldFailDelete) {
        return Promise.reject(new ApiRequestError('Failed to delete user', 400));
      }
      return Promise.resolve({ success: true });
    }),
    resetUserPassword: vi.fn().mockImplementation(() => {
      if (options.shouldFailReset) {
        return Promise.reject(new ApiRequestError('Failed to reset password', 400));
      }
      return Promise.resolve({ message: 'Password reset email sent' });
    }),
  };
}
