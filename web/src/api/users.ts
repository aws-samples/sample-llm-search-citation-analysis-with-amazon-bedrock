import {
  apiGet, apiPost, apiPut, apiDelete 
} from './client';

/** Cognito's account states, as `manage-users.py` passes them through. */
export type CognitoUserStatus =
  | 'CONFIRMED'
  | 'UNCONFIRMED'
  | 'FORCE_CHANGE_PASSWORD'
  | 'RESET_REQUIRED'
  | 'EXTERNAL_PROVIDER'
  | 'COMPROMISED'
  | 'ARCHIVED'
  | 'UNKNOWN';

export interface CognitoUser {
  username: string;
  email: string;
  email_verified: boolean;
  status: CognitoUserStatus;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
  groups: string[];
}

export interface ListUsersResponse {
  users: CognitoUser[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface InviteUserRequest {
  email: string;
  groups?: string[];
}

export interface InviteUserResponse {
  /** The invited user; `groups` holds only the groups they were actually added to. */
  user: CognitoUser;
  message: string;
  /** Present when some requested groups could not be assigned. */
  warning?: string;
  groups_failed?: string[];
}

export interface UpdateUserRequest {
  enabled?: boolean;
  groups?: string[];
}

export interface ResetPasswordResponse {
  message: string;
  /** `invite_resent` for a user who has not signed in yet, `password_reset` otherwise. */
  action: 'invite_resent' | 'password_reset';
}

/** The most users `GET /users` returns per page. */
export const USERS_PAGE_LIMIT = 100;

export async function listUsers(limit = 50, offset = 0): Promise<ListUsersResponse> {
  return apiGet<ListUsersResponse>(`/users?limit=${limit}&offset=${offset}`);
}

export async function inviteUser(request: InviteUserRequest): Promise<InviteUserResponse> {
  return apiPost<InviteUserResponse>('/users', request);
}

export async function updateUser(username: string, request: UpdateUserRequest): Promise<{ user: CognitoUser }> {
  return apiPut<{ user: CognitoUser }>(`/users/${encodeURIComponent(username)}`, request);
}

export async function deleteUser(username: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/users/${encodeURIComponent(username)}`);
}

/** Resets the password, or resends the invitation while the user has not signed in yet. */
export async function resetUserPassword(username: string): Promise<ResetPasswordResponse> {
  return apiPost<ResetPasswordResponse>(`/users/${encodeURIComponent(username)}/reset-password`, {});
}
