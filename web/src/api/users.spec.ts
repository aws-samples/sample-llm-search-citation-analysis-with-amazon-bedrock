import {
  describe, it, expect, vi 
} from 'vitest';
import {
  listUsers,
  inviteUser,
  updateUser,
  deleteUser,
  resetUserPassword,
} from './users';
import {
  mockApiDelete, mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('users API', () => {
  describe('listUsers', () => {
    it('fetches the first page of users with the default limit', async () => {
      const mockResponse = {
        users: [],
        count: 0,
        limit: 50,
        next_token: null 
      };
      mockApiGet.mockResolvedValue(mockResponse);

      const result = await listUsers();

      expect(result).toStrictEqual(mockResponse);
      expect(mockApiGet).toHaveBeenCalledWith('/users', { params: { limit: '50' } });
    });

    it('sends next_token when continuing the listing', async () => {
      mockApiGet.mockResolvedValue({
        users: [],
        next_token: null 
      });

      await listUsers(25, 'page-2');

      expect(mockApiGet).toHaveBeenCalledWith('/users', {
        params: {
          limit: '25',
          next_token: 'page-2' 
        } 
      });
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
    it('answers which action the server took', async () => {
      mockApiPost.mockResolvedValue({
        message: 'Invitation email sent again',
        action: 'invite_resent',
      });

      const result = await resetUserPassword('test');

      expect(result).toStrictEqual({
        message: 'Invitation email sent again',
        action: 'invite_resent',
      });
    });

    it('posts to the reset-password route of the URL-encoded username', async () => {
      mockApiPost.mockResolvedValue({
        message: 'Password reset',
        action: 'password_reset',
      });

      await resetUserPassword('a+b@example.com');

      expect(mockApiPost).toHaveBeenCalledWith('/users/a%2Bb%40example.com/reset-password', {});
    });
  });
});
