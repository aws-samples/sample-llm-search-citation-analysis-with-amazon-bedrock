import {
  apiGet, apiPost, apiPut, apiDelete 
} from './client';

export interface CognitoUser {
  username: string;
  email: string;
  email_verified: boolean;
  status: 'CONFIRMED' | 'UNCONFIRMED' | 'FORCE_CHANGE_PASSWORD' | 'RESET_REQUIRED' | 'UNKNOWN';
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
  groups: string[];
}

export interface UserGroup {
  name: string;
  description: string;
  precedence: number;
}

export interface ListUsersResponse {
  users: CognitoUser[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ListGroupsResponse {groups: UserGroup[];}

export interface InviteUserRequest {
  email: string;
  groups?: string[];
}

export interface UpdateUserRequest {
  enabled?: boolean;
  groups?: string[];
}

export async function listUsers(limit = 50, offset = 0): Promise<ListUsersResponse> {
  return apiGet<ListUsersResponse>(`/users?limit=${limit}&offset=${offset}`);
}

export async function getUser(username: string): Promise<{ user: CognitoUser }> {
  return apiGet<{ user: CognitoUser }>(`/users/${encodeURIComponent(username)}`);
}

export async function inviteUser(request: InviteUserRequest): Promise<{
  user: CognitoUser;
  message: string 
}> {
  return apiPost<{
    user: CognitoUser;
    message: string 
  }>('/users', request);
}

export async function updateUser(username: string, request: UpdateUserRequest): Promise<{ user: CognitoUser }> {
  return apiPut<{ user: CognitoUser }>(`/users/${encodeURIComponent(username)}`, request);
}

export async function deleteUser(username: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/users/${encodeURIComponent(username)}`);
}

export async function resetUserPassword(username: string): Promise<{ message: string }> {
  return apiPost<{ message: string }>(`/users/${encodeURIComponent(username)}/reset-password`, {});
}

export async function listGroups(): Promise<ListGroupsResponse> {
  return apiGet<ListGroupsResponse>('/users/groups');
}
