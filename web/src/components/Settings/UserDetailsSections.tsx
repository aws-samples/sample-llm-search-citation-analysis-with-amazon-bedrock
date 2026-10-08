import { useId } from 'react';
import type { ReactNode } from 'react';
import type { CognitoUser } from '../../api/users';
import {
  formatDate, formatDateOnly
} from '../../formatting/dateFormatter';
import { ErrorAlert } from '../ui/ErrorAlert';
import { UserStatusBadge } from './UserBadges';
import { statusOf } from './UserPresentation';

/** Shown instead of the controls an admin cannot use on their own account (the server refuses them too). */
const SELF_NOTE = "This is your account. You can't change your own role or remove yourself.";

/** Status, hint and dates at the top of the manage dialog. */
export function UserDetailsSummary({
  user, isSelf
}: {
  readonly user: CognitoUser;
  readonly isSelf: boolean 
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UserStatusBadge user={user} />
        <span className="text-sm text-gray-600">{statusOf(user).hint}</span>
      </div>
      <p className="text-xs text-gray-500">
        Added {formatDateOnly(user.created_at)} · Last changed {formatDate(user.updated_at)}
      </p>
      {isSelf && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{SELF_NOTE}</p>}
    </div>
  );
}

/** A titled block of the manage dialog, separated from the one above. */
export function UserDetailsSection({
  title, description, children
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode 
}) {
  return (
    <section className="border-t border-gray-200 pt-4 space-y-2">
      <h4 className="text-sm font-medium text-gray-900">{title}</h4>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      {children}
    </section>
  );
}

interface AccessSwitchProps {
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}

/** "Can sign in" on/off switch. */
export function AccessSwitch({
  enabled, disabled, onToggle
}: AccessSwitchProps) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between">
      <span id={labelId} className="text-sm text-gray-700">Can sign in</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-500'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-zinc-50 shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  );
}

export interface DialogFeedback {
  readonly tone: 'success' | 'error';
  readonly text: string;
}

/** The result of the dialog's last action: announced success or an alert. */
export function DialogFeedbackNotice({ feedback }: { readonly feedback: DialogFeedback | null }) {
  if (feedback?.tone === 'success') {
    return <output className="block rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{feedback.text}</output>;
  }
  return <ErrorAlert message={feedback?.text ?? null} />;
}
