import type { CognitoUser } from '../../api/users';
import {
  formatDate, formatDateOnly
} from '../../formatting/dateFormatter';
import { Button } from '../ui/Button';
import {
  SkeletonRegion, SkeletonTable
} from '../ui/Skeleton';
import {
  UserRoleBadge, UserStatusBadge, YouTag
} from './UserBadges';
import {
  isSignedInUser, statusOf
} from './UserPresentation';

const HEADER_CELL = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const COLUMNS = ['Person', 'Role', 'Status', 'Added'] as const;

/** Placeholder rows shaped like the real ones, for the first load. */
export const UsersTableSkeleton = () => (
  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
    <SkeletonRegion label="Loading users">
      <SkeletonTable rows={5} columns={5} rowClassName="h-[69px]" />
    </SkeletonRegion>
  </div>
);

interface UsersTableProps {
  readonly users: readonly CognitoUser[];
  readonly signedInIdentity: ReadonlySet<string>;
  readonly onManage: (user: CognitoUser) => void;
  /** Shown in place of rows when `users` is empty. */
  readonly emptyMessage: string;
}

function UserRow({
  user, isSelf, onManage
}: {
  readonly user: CognitoUser;
  readonly isSelf: boolean;
  readonly onManage: (user: CognitoUser) => void 
}) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4">
        <span className="text-sm font-medium text-gray-900">{user.email}</span>
        {isSelf && <YouTag />}
      </td>
      <td className="px-6 py-4">
        <UserRoleBadge groups={user.groups} />
      </td>
      <td className="px-6 py-4" title={`Last changed ${formatDate(user.updated_at)}`}>
        <UserStatusBadge user={user} />
        <p className="text-xs text-gray-500 mt-1">{statusOf(user).hint}</p>
      </td>
      <td className="px-6 py-4 text-sm text-gray-500">{formatDateOnly(user.created_at)}</td>
      <td className="px-6 py-4 text-right">
        <Button variant="secondary" size="sm" aria-label={`Manage ${user.email}`} onClick={() => onManage(user)}>
          Manage
        </Button>
      </td>
    </tr>
  );
}

/** One row per person with their role, status, date added and a Manage button. */
export function UsersTable({
  users, signedInIdentity, onManage, emptyMessage
}: UsersTableProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map((column) => <th key={column} scope="col" className={HEADER_CELL}>{column}</th>)}
            <th scope="col" className="px-6 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-6 py-8 text-center text-sm text-gray-500">{emptyMessage}</td>
            </tr>
          ) : users.map((user) => (
            <UserRow key={user.username} user={user} isSelf={isSignedInUser(user, signedInIdentity)} onManage={onManage} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
