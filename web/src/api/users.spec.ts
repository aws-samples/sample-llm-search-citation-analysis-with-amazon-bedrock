import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  listUsers,
  getUser,
  inviteUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  listGroups,
} from './users';

vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

import {
  apiGet, apiPost, apiPut, apiDelete 
} from './client';

const mockApiGet = apiGet as ReturnType<typeof vi.fn>;
const mockApiPost = apiPost as ReturnType<typeof vi.fn>;
const mockApiPut = apiPut as ReturnType<typeof vi.fn>;
const mockApiDelete = apiDelete as ReturnType<typeof vi.fn>;

describe('users API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listUsers', () => {
    it('fetches users with default pagination', async () => {
      const mockResponse = {
        users: [],
        total: 0,
        has_more: false 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await listUsers();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/users?limit=50&offset=0');
    });

    it('fetches users with custom pagination', async () => {
      mockApiGet.mockResolvedValue({
        users: [],
        total: 100 
      });

      await listUsers(25, 50);

      expect(mockApiGet).toHaveBeenCalledWith('/users?limit=25&offset=50');
    });
  });

  describe('getUser', () => {
    it('fetches user by username', async () => {
      const mockUser = {
        username: 'test',
        email: 'test@example.com' 
      };
      mockApiGet.mockResolvedValue({ user: mockUser });

      const result = await getUser('test');

      expect(result.user).toStrictEqual(mockUser);
      expect(mockApiGet).toHaveBeenCalledWith('/users/test');
    });

    it('encodes username in URL', async () => {
      mockApiGet.mockResolvedValue({ user: {} });

      await getUser('user@example.com');

      expect(mockApiGet).toHaveBeenCalledWith('/users/user%40example.com');
    });
  });

  describe('inviteUser', () => {
    it('invites user with email', async () => {
      const mockResponse = {
        user: { email: 'new@example.com' },
        message: 'Invited' 
      };
      mockApiPost.mockResolvedValue(mockResponse);

      const result = await inviteUser({ email: 'new@example.com' });

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiPost).toHaveBeenCalledWith('/users', { email: 'new@example.com' });
    });

    it('invites user with groups', async () => {
      mockApiPost.mockResolvedValue({
        user: {},
        message: 'Invited' 
      });

      await inviteUser({
        email: 'new@example.com',
        groups: ['admin'] 
      });

      expect(mockApiPost).toHaveBeenCalledWith('/users', {
        email: 'new@example.com',
        groups: ['admin'],
      });
    });
  });

  describe('updateUser', () => {
    it('updates user enabled status', async () => {
      const mockUser = {
        username: 'test',
        enabled: false 
      };
      mockApiPut.mockResolvedValue({ user: mockUser });

      const result = await updateUser('test', { enabled: false });

      expect(result.user).toStrictEqual(mockUser);
      expect(mockApiPut).toHaveBeenCalledWith('/users/test', { enabled: false });
    });

    it('updates user groups', async () => {
      mockApiPut.mockResolvedValue({ user: {} });

      await updateUser('test', { groups: ['admin', 'users'] });

      expect(mockApiPut).toHaveBeenCalledWith('/users/test', { groups: ['admin', 'users'] });
    });
  });

  describe('deleteUser', () => {
    it('deletes user and returns message', async () => {
      mockApiDelete.mockResolvedValue({ message: 'User deleted' });

      const result = await deleteUser('test');

      expect(result.message).toBe('User deleted');
      expect(mockApiDelete).toHaveBeenCalledWith('/users/test');
    });
  });

  describe('resetUserPassword', () => {
    it('resets password and returns message', async () => {
      mockApiPost.mockResolvedValue({ message: 'Password reset' });

      const result = await resetUserPassword('test');

      expect(result.message).toBe('Password reset');
      expect(mockApiPost).toHaveBeenCalledWith('/users/test/reset-password', {});
    });
  });

  describe('listGroups', () => {
    it('returns groups from API', async () => {
      const mockGroups = [{
        name: 'admin',
        description: 'Admins' 
      }];
      mockApiGet.mockResolvedValue({ groups: mockGroups });

      const result = await listGroups();

      expect(result.groups).toStrictEqual(mockGroups);
      expect(mockApiGet).toHaveBeenCalledWith('/users/groups');
    });
  });
});
