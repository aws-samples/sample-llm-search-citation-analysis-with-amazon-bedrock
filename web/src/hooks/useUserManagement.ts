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

interface MessageOutcome {
  success: boolean;
  message?: string;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Runs a request that answers with a message; a failure becomes an unsuccessful outcome with the error's text. */
async function messageOutcome(
  request: () => Promise<{ message?: string }>,
  failure: string
): Promise<MessageOutcome> {
  try {
    const response = await request();
    return {
      success: true,
      message: response.message,
    };
  } catch (err) {
    return {
      success: false,
      message: errorText(err, failure),
    };
  }
}

interface UseUserManagementReturn {
  users: CognitoUser[];
  groups: UserGroup[];
  loading: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
  refresh: () => Promise<void>;
  invite: (request: InviteUserRequest) => Promise<MessageOutcome>;
  update: (username: string, request: UpdateUserRequest) => Promise<boolean>;
  remove: (username: string) => Promise<boolean>;
  resetPassword: (username: string) => Promise<MessageOutcome>;
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
      setError(errorText(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const invite = useCallback(async (request: InviteUserRequest) => messageOutcome(async () => {
    const response = await inviteUser(request);
    await fetchData();
    return response;
  // Stryker disable next-line ArrayDeclaration: React dependency list; fetchData has a stable identity, so omitting it cannot stale this callback
  }, 'Failed to invite user'), [fetchData]);

  const mutateAndRefresh = useCallback(async (mutation: () => Promise<unknown>, failure: string) => {
    try {
      await mutation();
      await fetchData();
      return true;
    } catch (err) {
      setError(errorText(err, failure));
      return false;
    }
  }, [fetchData]);

  const update = useCallback(
    async (username: string, request: UpdateUserRequest) => mutateAndRefresh(
      () => updateUser(username, request),
      'Failed to update user'
    ),
    // Stryker disable next-line ArrayDeclaration: React dependency list; mutateAndRefresh has a stable identity, so omitting it cannot stale this callback
    [mutateAndRefresh]
  );

  const remove = useCallback(
    async (username: string) => mutateAndRefresh(() => deleteUser(username), 'Failed to delete user'),
    // Stryker disable next-line ArrayDeclaration: React dependency list; mutateAndRefresh has a stable identity, so omitting it cannot stale this callback
    [mutateAndRefresh]
  );

  const resetPassword = useCallback(
    async (username: string) => messageOutcome(() => resetUserPassword(username), 'Failed to reset password'),
    // Stryker disable next-line ArrayDeclaration: React dependency list; the callback reads only module functions, so any list keeps it correct
    []
  );

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
