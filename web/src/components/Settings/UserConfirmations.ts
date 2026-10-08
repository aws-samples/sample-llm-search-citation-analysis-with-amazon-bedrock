import type { CognitoUser } from '../../api/users';
import { isPendingInvite } from './UserPresentation';

/** The actions of the manage dialog that ask for confirmation first. */
export type ConfirmedAction = 'disable' | 'password' | 'delete';

interface Confirmation {
  readonly title: string;
  readonly message: string;
  readonly confirmText: string;
  readonly confirmVariant: 'danger' | 'primary';
}

/** Title, message (naming the email) and button of the confirmation for `action` on `user`. */
export function confirmationFor(action: ConfirmedAction, user: Pick<CognitoUser, 'email' | 'status'>): Confirmation {
  if (action === 'disable') {
    return {
      title: 'Disable access?',
      message: `${user.email} won't be able to sign in until you enable access again. Their role is kept.`,
      confirmText: 'Disable access',
      confirmVariant: 'danger',
    };
  }
  if (action === 'delete') {
    return {
      title: 'Delete user?',
      message: `${user.email} will lose access and their account will be removed permanently. This cannot be undone.`,
      confirmText: 'Delete user',
      confirmVariant: 'danger',
    };
  }
  return isPendingInvite(user)
    ? {
      title: 'Resend invite?',
      message: `${user.email} will get a new invitation email with a new temporary password. The previous one stops working.`,
      confirmText: 'Resend invite',
      confirmVariant: 'primary',
    }
    : {
      title: 'Reset password?',
      message: `${user.email} will be emailed a code to choose a new password and can't sign in with the current one until they do.`,
      confirmText: 'Reset password',
      confirmVariant: 'primary',
    };
}

interface PasswordCopy {
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly success: string;
}

/** The password block's wording: resend the invite while it is pending, reset the password otherwise. */
export function passwordCopy(user: Pick<CognitoUser, 'status'>): PasswordCopy {
  return isPendingInvite(user)
    ? {
      title: 'Invitation',
      description: "They haven't signed in yet. Resending emails a new temporary password.",
      action: 'Resend invite',
      success: 'Invitation email sent again.',
    }
    : {
      title: 'Password',
      description: 'Sends a code by email so they can choose a new password.',
      action: 'Reset password',
      success: 'Password reset email sent.',
    };
}
