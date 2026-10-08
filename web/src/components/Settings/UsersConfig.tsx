import {
  useEffect, useState
} from 'react';
import {
  useUserManagement, type UserActionOutcome
} from '../../hooks/useUserManagement';
import type { CognitoUser } from '../../api/users';
import { Button } from '../ui/Button';
import {
  PlusIcon, RefreshIcon
} from '../ui/Icons';
import {
  INVITE_VALID_DAYS, InviteModal
} from './UserModals';
import { UserDetailsModal } from './UserDetailsModal';
import {
  UsersTable, UsersTableSkeleton
} from './UsersTable';
import { UsersToolbar } from './UsersToolbar';
import {
  filterUsers, isFiltering, NO_USERS_FILTER, summarizeUsers, type UsersFilter
} from './UsersFilter';
import {
  groupsForRole, isSignedInUser, type UserRole
} from './UserPresentation';
import { SettingsErrorNotice } from './SettingsErrorNotice';
import { SettingsSectionHeader } from './SettingsSectionHeader';

interface PageNotice {
  readonly tone: 'success' | 'warning';
  readonly text: string;
}

const NOTICE_CLASS: Readonly<Record<PageNotice['tone'], string>> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

/** How long a page notice stays before it clears itself. */
const NOTICE_MS = 8000;

function inviteNotice(email: string, outcome: UserActionOutcome): PageNotice {
  return outcome.warning
    ? {
      tone: 'warning',
      text: `${outcome.warning}. Open Manage for ${email} to check their role.`,
    }
    : {
      tone: 'success',
      text: `Invitation sent to ${email}. The temporary password expires in ${INVITE_VALID_DAYS} days.`,
    };
}

function headCount(users: readonly CognitoUser[], shown: number, total: number, filtering: boolean): string {
  if (filtering) return `Showing ${shown} of ${users.length}`;
  const summary = summarizeUsers(users);
  return total > users.length ? `${summary} · showing ${users.length} of ${total}` : summary;
}

/** Clears `notice` a while after it was set. */
function useExpiringNotice() {
  const [notice, setNotice] = useState<PageNotice | null>(null);
  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

/** Settings › Users: everyone with access, their role and status, and the invite and manage dialogs. */
export function UsersConfig() {
  const {
    users, loading, refreshing, error, total, signedInIdentity, refresh, invite, update, remove, resetPassword,
  } = useUserManagement();
  const [inviting, setInviting] = useState(false);
  const [managedUsername, setManagedUsername] = useState<string | null>(null);
  const [filter, setFilter] = useState<UsersFilter>(NO_USERS_FILTER);
  const [notice, setNotice] = useExpiringNotice();

  const managed = users.find((user) => user.username === managedUsername) ?? null;
  const shown = filterUsers(users, filter);
  const filtering = isFiltering(filter);

  const handleInvite = async (email: string, role: UserRole) => {
    const outcome = await invite({
      email,
      groups: groupsForRole([], role),
    });
    if (outcome.success) setNotice(inviteNotice(email, outcome));
    return outcome;
  };

  const handleDelete = async (user: CognitoUser) => {
    const outcome = await remove(user.username);
    if (outcome.success) {
      setManagedUsername(null);
      setNotice({
        tone: 'success',
        text: `${user.email} was deleted.`,
      });
    }
    return outcome;
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Users" description="Invite people and choose who can change settings.">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            leadingIcon={<RefreshIcon className="w-4 h-4" />}
            onClick={() => { void refresh(); }}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button leadingIcon={<PlusIcon className="w-4 h-4" />} onClick={() => setInviting(true)}>
            Invite user
          </Button>
        </div>
      </SettingsSectionHeader>

      <SettingsErrorNotice error={error} />

      {notice && <output className={`block rounded-lg border p-3 text-sm ${NOTICE_CLASS[notice.tone]}`}>{notice.text}</output>}

      {loading ? <UsersTableSkeleton /> : (
        <>
          <UsersToolbar filter={filter} onChange={setFilter} summary={headCount(users, shown.length, total, filtering)} />
          <UsersTable
            users={shown}
            signedInIdentity={signedInIdentity}
            onManage={(user) => setManagedUsername(user.username)}
            emptyMessage={filtering ? 'No one matches these filters.' : 'No users yet. Invite someone to get started.'}
          />
        </>
      )}

      {inviting && <InviteModal onClose={() => setInviting(false)} onInvite={handleInvite} />}

      {managed && (
        <UserDetailsModal
          key={managed.username}
          user={managed}
          isSelf={isSignedInUser(managed, signedInIdentity)}
          onClose={() => setManagedUsername(null)}
          onSaveRole={(role) => update(managed.username, { groups: groupsForRole(managed.groups, role) })}
          onSetEnabled={(enabled) => update(managed.username, { enabled })}
          onResetPassword={() => resetPassword(managed.username)}
          onDelete={() => handleDelete(managed)}
        />
      )}
    </div>
  );
}
