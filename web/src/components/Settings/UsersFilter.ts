import type { CognitoUser } from '../../api/users';
import {
  roleOf, statusOf, type StatusKind, type UserRole
} from './UserPresentation';

export interface UsersFilter {
  readonly query: string;
  readonly role: UserRole | 'all';
  readonly status: StatusKind | 'all';
}

export const NO_USERS_FILTER: UsersFilter = {
  query: '',
  role: 'all',
  status: 'all',
};

export function isFiltering(filter: UsersFilter): boolean {
  return filter.query.trim() !== '' || filter.role !== 'all' || filter.status !== 'all';
}

/** The users whose email contains the query (case-insensitive) and who match the role and status picked. */
export function filterUsers(users: readonly CognitoUser[], filter: UsersFilter): CognitoUser[] {
  const query = filter.query.trim().toLowerCase();
  return users.filter((user) => user.email.toLowerCase().includes(query)
    && (filter.role === 'all' || roleOf(user.groups) === filter.role)
    && (filter.status === 'all' || statusOf(user).kind === filter.status));
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "14 people · 9 invites pending · 1 disabled"; the pending and disabled parts only when non-zero. */
export function summarizeUsers(users: readonly CognitoUser[]): string {
  const pending = users.filter((user) => statusOf(user).kind === 'pending').length;
  const disabled = users.filter((user) => statusOf(user).kind === 'disabled').length;
  return [
    plural(users.length, 'person', 'people'),
    pending > 0 ? plural(pending, 'invite pending', 'invites pending') : null,
    disabled > 0 ? `${disabled} disabled` : null,
  ].filter((part) => part !== null).join(' · ');
}
