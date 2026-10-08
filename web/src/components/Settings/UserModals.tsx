import {
  useId, useState
} from 'react';
import type { FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import type { UserActionOutcome } from '../../hooks/useUserManagement';
import type { UserRole } from './UserPresentation';
import { UserRolePicker } from './UserRolePicker';
import { useDialogFocus } from './UserDialogFocus';

/** Cognito's default `TemporaryPasswordValidityDays`; `lib/constructs/auth.ts` does not override it. */
export const INVITE_VALID_DAYS = 7;

interface InviteModalProps {
  readonly onClose: () => void;
  /** Sends the invitation; the modal closes on success and shows the failure otherwise. */
  readonly onInvite: (email: string, role: UserRole) => Promise<UserActionOutcome>;
}

/** Email + role form that sends a Cognito invitation. */
export function InviteModal({
  onClose, onInvite
}: InviteModalProps) {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setSending(true);
    setError(null);
    const outcome = await onInvite(address, role);
    setSending(false);
    if (outcome.success) {
      onClose();
    } else {
      setError(outcome.message ?? 'Failed to invite user');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Invite someone">
      <form onSubmit={(event) => { void handleSubmit(event); }} className="space-y-4">
        <div>
          <label htmlFor={emailId} className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            We&apos;ll email them a temporary password. It expires after {INVITE_VALID_DAYS} days; you can resend the invite from Manage.
          </p>
        </div>

        <UserRolePicker value={role} onChange={setRole} />

        <ErrorAlert message={error} />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? 'Sending…' : 'Send invite'}
          </Button>
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
