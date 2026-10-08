import type { CognitoUser } from '../../api/users';
import {
  roleLabel, roleOf, STATUS_BADGE_CLASS, statusOf
} from './UserPresentation';

const PILL = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';

/** The account's plain-language status as a coloured pill. */
export const UserStatusBadge = ({ user }: { readonly user: Pick<CognitoUser, 'status' | 'enabled'> }) => {
  const status = statusOf(user);
  return <span className={`${PILL} ${STATUS_BADGE_CLASS[status.kind]}`}>{status.label}</span>;
};

/** Admin as a violet pill, Member as plain text. */
export const UserRoleBadge = ({ groups }: { readonly groups: readonly string[] }) => {
  const role = roleOf(groups);
  return role === 'admin'
    ? <span className={`${PILL} bg-violet-50 text-violet-700`}>{roleLabel(role)}</span>
    : <span className="text-sm text-gray-600">{roleLabel(role)}</span>;
};

/** Marks the signed-in person's own row. */
export const YouTag = () => (
  <span className="ml-2 inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">You</span>
);
