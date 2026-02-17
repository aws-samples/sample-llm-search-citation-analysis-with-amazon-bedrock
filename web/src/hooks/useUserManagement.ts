import {
  useState, useEffect, useCallback 
} from 'react';
import {
  listUsers,
  listGroups,
  inviteUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  type CognitoUser,
  type UserGroup,
  type InviteUserRequest,
  type UpdateUserRequest,
} from '../api/users';

interface UseUserManagementReturn {
  users: CognitoUser[];
  groups: UserGroup[];
  loading: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
  refresh: () => Promise<void>;
  invite: (request: InviteUserRequest) => Promise<{
    success: boolean;
    message?: string 
  }>;
  update: (username: string, request: UpdateUserRequest) => Promise<boolean>;
  remove: (username: string) => Promise<boolean>;
  resetPassword: (username: string) => Promise<{
    success: boolean;
    message?: string 
  }>;
}

export function useUserManagement(): UseUserManagementReturn {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, groupsResponse] = await Promise.all([
        listUsers(100, 0),
        listGroups(),
      ]);
      setUsers(usersResponse.users);
      setTotal(usersResponse.total);
      setHasMore(usersResponse.has_more);
      setGroups(groupsResponse.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const invite = useCallback(async (request: InviteUserRequest) => {
    try {
      const response = await inviteUser(request);
      await fetchData();
      return {
        success: true,
        message: response.message 
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to invite user';
      return {
        success: false,
        message 
      };
    }
  }, [fetchData]);

  const update = useCallback(async (username: string, request: UpdateUserRequest) => {
    try {
      await updateUser(username, request);
      await fetchData();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
      return false;
    }
  }, [fetchData]);

  const remove = useCallback(async (username: string) => {
    try {
      await deleteUser(username);
      await fetchData();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
      return false;
    }
  }, [fetchData]);

  const resetPassword = useCallback(async (username: string) => {
    try {
      const response = await resetUserPassword(username);
      return {
        success: true,
        message: response.message 
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset password';
      return {
        success: false,
        message 
      };
    }
  }, []);

  return {
    users,
    groups,
    loading,
    error,
    total,
    hasMore,
    refresh: fetchData,
    invite,
    update,
    remove,
    resetPassword,
  };
}
