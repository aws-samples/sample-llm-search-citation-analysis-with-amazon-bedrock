import {
  useCallback, useState
} from 'react';
import type { CognitoUser } from '../../api/users';
import type { UserActionOutcome } from '../../hooks/useUserManagement';
import {
  ConfirmModal, Modal
} from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  roleLabel, roleOf, type UserRole
} from './UserPresentation';
import { UserRolePicker } from './UserRolePicker';
import {
  AccessSwitch, DialogFeedbackNotice, UserDetailsSection, UserDetailsSummary, type DialogFeedback
} from './UserDetailsSections';
import {
  confirmationFor, passwordCopy, type ConfirmedAction
} from './UserConfirmations';
import {
  useDialogFocus, useStackedDialogFocus
} from './UserDialogFocus';

type BusyAction = 'role' | 'access' | ConfirmedAction;

interface UserDetailsModalProps {
  readonly user: CognitoUser;
  /** The signed-in admin's own account: role, access and delete are locked. */
  readonly isSelf: boolean;
  readonly onClose: () => void;
  readonly onSaveRole: (role: UserRole) => Promise<UserActionOutcome>;
  readonly onSetEnabled: (enabled: boolean) => Promise<UserActionOutcome>;
  /** Resets the password, or resends the invite while it is pending. */
  readonly onResetPassword: () => Promise<UserActionOutcome>;
  /** Deletes the user; the parent closes the dialog on success. */
  readonly onDelete: () => Promise<UserActionOutcome>;
}

/** Runs one dialog action at a time and turns its outcome into the dialog's feedback. */
function useDialogActions() {
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState<DialogFeedback | null>(null);

  const run = async (action: BusyAction, request: () => Promise<UserActionOutcome>, successText: string) => {
    setBusy(action);
    setFeedback(null);
    const outcome = await request();
    setBusy(null);
    setFeedback(outcome.success
      ? {
        tone: 'success',
        text: successText,
      }
      : {
        tone: 'error',
        text: outcome.message ?? 'Something went wrong',
      });
  };

  return {
    busy,
    feedback,
    run,
  };
}

/** One person's role, access, password and removal, each saved on its own with feedback in the dialog. */
export function UserDetailsModal({
  user, isSelf, onClose, onSaveRole, onSetEnabled, onResetPassword, onDelete
}: UserDetailsModalProps) {
  const [confirming, setConfirming] = useState<ConfirmedAction | null>(null);
  const {
    busy, feedback, run
  } = useDialogActions();
  const password = passwordCopy(user);
  useDialogFocus();
  useStackedDialogFocus(confirming);
  const closeConfirmation = useCallback(() => setConfirming(null), []);

  const confirmed: Record<ConfirmedAction, () => Promise<void>> = {
    disable: () => run('disable', () => onSetEnabled(false), 'Access disabled. They can no longer sign in.'),
    password: () => run('password', onResetPassword, password.success),
    delete: () => run('delete', onDelete, 'User deleted.'),
  };

  const toggleAccess = () => {
    if (user.enabled) {
      setConfirming('disable');
    } else {
      void run('access', () => onSetEnabled(true), 'Access enabled. They can sign in again.');
    }
  };

  const confirmation = confirming === null ? null : confirmationFor(confirming, user);
  const locked = isSelf || busy !== null;

  return (
    <>
      <Modal isOpen onClose={() => { if (confirming === null) onClose(); }} title={user.email} size="xl">
        <div className="space-y-4">
          <UserDetailsSummary user={user} isSelf={isSelf} />

          <RoleSection
            savedRole={roleOf(user.groups)}
            isSelf={isSelf}
            busy={busy}
            onSave={(role) => { void run('role', () => onSaveRole(role), `Role changed to ${roleLabel(role)}.`); }}
          />

          <UserDetailsSection title="Access" description="Disabled accounts keep their role but can't sign in.">
            <AccessSwitch enabled={user.enabled} disabled={locked} onToggle={toggleAccess} />
          </UserDetailsSection>

          <UserDetailsSection title={password.title} description={password.description}>
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setConfirming('password')}>
              {busy === 'password' ? 'Sending…' : password.action}
            </Button>
          </UserDetailsSection>

          {!isSelf && (
            <UserDetailsSection title="Remove" description="Deleting removes the account permanently.">
              <Button variant="danger" size="sm" disabled={busy !== null} onClick={() => setConfirming('delete')}>
                {busy === 'delete' ? 'Deleting…' : 'Delete user'}
              </Button>
            </UserDetailsSection>
          )}

          <DialogFeedbackNotice feedback={feedback} />

          <div className="flex justify-end border-t border-gray-200 pt-4">
            <Button variant="ghost" onClick={() => onClose()}>Close</Button>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        isOpen={confirmation !== null}
        onClose={closeConfirmation}
        onConfirm={() => { if (confirming !== null) void confirmed[confirming](); }}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        confirmText={confirmation?.confirmText}
        confirmVariant={confirmation?.confirmVariant}
      />
    </>
  );
}

interface RoleSectionProps {
  readonly savedRole: UserRole;
  readonly isSelf: boolean;
  readonly busy: BusyAction | null;
  readonly onSave: (role: UserRole) => void;
}

/** Role choice with its own Save button; locked with an explanation on the admin's own account. */
function RoleSection({
  savedRole, isSelf, busy, onSave
}: RoleSectionProps) {
  const [role, setRole] = useState<UserRole>(savedRole);
  return (
    <UserDetailsSection title="Role">
      <UserRolePicker value={role} onChange={setRole} disabled={isSelf || busy !== null} legendHidden />
      {!isSelf && (
        <Button size="sm" disabled={role === savedRole || busy !== null} onClick={() => onSave(role)}>
          {busy === 'role' ? 'Saving…' : 'Save role'}
        </Button>
      )}
    </UserDetailsSection>
  );
}
