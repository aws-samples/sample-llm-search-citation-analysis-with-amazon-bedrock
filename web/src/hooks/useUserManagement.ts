import {
  useState, useEffect, useCallback 
} from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  listUsers,
  inviteUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  USERS_PAGE_LIMIT,
  type CognitoUser,
  type InviteUserRequest,
  type UpdateUserRequest,
} from '../api/users';
import { collectCursorPages } from '../api/cursorPages';

/** What a user action came to; `message` is the server's answer or the error to show. */
export interface UserActionOutcome {
  success: boolean;
  message?: string;
  /** A partial success worth telling the admin about (e.g. a group that could not be assigned). */
  warning?: string;
}

/** The ID-token claims the server compares a target account against to refuse self-changes. */
const IDENTITY_CLAIMS = ['email', 'cognito:username', 'sub'] as const;

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Runs `request`; a rejection becomes an unsuccessful outcome carrying the error's text. */
async function outcomeOf(
  request: () => Promise<{
    message?: string;
    warning?: string 
  }>,
  failure: string
): Promise<UserActionOutcome> {
  try {
    const {
      message, warning 
    } = await request();
    return {
      success: true,
      message,
      ...(warning ? { warning } : {}),
    };
  } catch (err) {
    return {
      success: false,
      message: errorText(err, failure),
    };
  }
}

interface UserListing {
  users: CognitoUser[];
  total: number;
}

/** Every page of `GET /users`, following `next_token` until the server reports the last page. */
async function listAllUsers(): Promise<UserListing> {
  const users = await collectCursorPages(async (nextToken) => {
    const page = await listUsers(USERS_PAGE_LIMIT, nextToken);
    return {
      items: page.users,
      nextToken: page.next_token,
    };
  });
  return {
    users,
    total: users.length,
  };
}

function replaceUser(users: CognitoUser[], updated: CognitoUser): CognitoUser[] {
  return users.map((existing) => (existing.username === updated.username ? updated : existing));
}

function withoutUser(users: CognitoUser[], username: string): CognitoUser[] {
  return users.filter((existing) => existing.username !== username);
}

/** The signed-in account's identifiers, lower-cased; empty when there is no session. */
async function readSignedInIdentity(): Promise<ReadonlySet<string>> {
  try {
    const payload = (await fetchAuthSession()).tokens?.idToken?.payload ?? {};
    return new Set(IDENTITY_CLAIMS
      .map((claim) => payload[claim])
      .filter((value): value is string => typeof value === 'string' && value !== '')
      .map((value) => value.toLowerCase()));
  } catch {
    return new Set();
  }
}

interface UseUserManagementReturn {
  users: CognitoUser[];
  /** True until the first load settles; later loads set `refreshing` instead. */
  loading: boolean;
  refreshing: boolean;
  /** The last load error; action errors come back in each action's outcome. */
  error: string | null;
  total: number;
  /** Lower-cased identifiers of the signed-in account (email, username, sub). */
  signedInIdentity: ReadonlySet<string>;
  refresh: () => Promise<void>;
  invite: (request: InviteUserRequest) => Promise<UserActionOutcome>;
  update: (username: string, request: UpdateUserRequest) => Promise<UserActionOutcome>;
  remove: (username: string) => Promise<UserActionOutcome>;
  resetPassword: (username: string) => Promise<UserActionOutcome>;
}

export function useUserManagement(): UseUserManagementReturn {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [signedInIdentity, setSignedInIdentity] = useState<ReadonlySet<string>>(() => new Set());

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const listing = await listAllUsers();
      setUsers(listing.users);
      setTotal(listing.total);
    } catch (err) {
      setError(errorText(err, 'Failed to load users'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    void readSignedInIdentity().then(setSignedInIdentity);
  }, [fetchData]);

  const invite = useCallback(async (request: InviteUserRequest) => outcomeOf(async () => {
    const response = await inviteUser(request);
    void fetchData();
    return response;
  }, 'Failed to invite user'), [fetchData]);

  const update = useCallback(async (username: string, request: UpdateUserRequest) => outcomeOf(async () => {
    const { user } = await updateUser(username, request);
    setUsers((current) => replaceUser(current, user));
    void fetchData();
    return {};
  }, 'Failed to update user'), [fetchData]);

  const remove = useCallback(async (username: string) => outcomeOf(async () => {
    const response = await deleteUser(username);
    setUsers((current) => withoutUser(current, username));
    void fetchData();
    return response;
  }, 'Failed to delete user'), [fetchData]);

  const resetPassword = useCallback(async (username: string) => outcomeOf(async () => {
    const response = await resetUserPassword(username);
    void fetchData();
    return response;
  }, 'Failed to reset password'), [fetchData]);

  return {
    users,
    loading,
    refreshing: refreshing && !loading,
    error,
    total,
    signedInIdentity,
    refresh: fetchData,
    invite,
    update,
    remove,
    resetPassword,
  };
}
