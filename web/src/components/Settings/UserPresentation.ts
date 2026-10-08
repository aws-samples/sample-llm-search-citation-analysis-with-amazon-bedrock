import type { CognitoUser } from '../../api/users';
import { ADMIN_GROUP } from '../../infrastructure/auth';

/*
 * How the Users settings present a Cognito account: one role instead of raw
 * group membership, and plain-language statuses instead of Cognito's codes.
 */

/** The group every invited person joins; it grants nothing on its own (only `Admin` is checked server-side). */
export const MEMBER_GROUP = 'Users';

export type UserRole = 'admin' | 'member';

interface RoleOption {
  readonly role: UserRole;
  readonly label: string;
  readonly description: string;
}

export const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    role: 'member',
    label: 'Member',
    description: 'Can view dashboards and reports and use the everyday tools.',
  },
  {
    role: 'admin',
    label: 'Admin',
    description: 'Can also change settings, manage people and start paid runs.',
  },
];

/** Admin when the account is in the `Admin` group, Member otherwise. */
export function roleOf(groups: readonly string[]): UserRole {
  return groups.includes(ADMIN_GROUP) ? 'admin' : 'member';
}

export function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Admin' : 'Member';
}

/**
 * The groups that give `role`, keeping any group the role model does not own.
 * Both roles stay in `Users`; Admin adds `Admin`.
 */
export function groupsForRole(groups: readonly string[], role: UserRole): string[] {
  const others = groups.filter((group) => group !== ADMIN_GROUP && group !== MEMBER_GROUP);
  return role === 'admin' ? [...others, MEMBER_GROUP, ADMIN_GROUP] : [...others, MEMBER_GROUP];
}

export type StatusKind = 'active' | 'pending' | 'disabled' | 'attention';

interface StatusPresentation {
  readonly kind: StatusKind;
  readonly label: string;
  /** One short line explaining what the status means for the person. */
  readonly hint: string;
}

const STATUS_BY_CODE: Readonly<Record<CognitoUser['status'], StatusPresentation>> = {
  CONFIRMED: {
    kind: 'active',
    label: 'Active',
    hint: 'Can sign in',
  },
  EXTERNAL_PROVIDER: {
    kind: 'active',
    label: 'Active',
    hint: 'Signs in through an external provider',
  },
  FORCE_CHANGE_PASSWORD: {
    kind: 'pending',
    label: 'Invite pending',
    hint: "Hasn't signed in yet",
  },
  RESET_REQUIRED: {
    kind: 'attention',
    label: 'Password reset required',
    hint: 'Must choose a new password at next sign-in',
  },
  UNCONFIRMED: {
    kind: 'attention',
    label: 'Unconfirmed',
    hint: "Hasn't confirmed their email address",
  },
  COMPROMISED: {
    kind: 'attention',
    label: 'Blocked',
    hint: 'Blocked by Cognito after a suspected compromise',
  },
  ARCHIVED: {
    kind: 'attention',
    label: 'Archived',
    hint: 'No longer in use',
  },
  UNKNOWN: {
    kind: 'attention',
    label: 'Unknown',
    hint: 'Status not reported',
  },
};

const DISABLED_STATUS: StatusPresentation = {
  kind: 'disabled',
  label: 'Disabled',
  hint: "Can't sign in",
};

/** The account's status in plain words; a disabled account reads Disabled whatever Cognito's code. */
export function statusOf(user: Pick<CognitoUser, 'status' | 'enabled'>): StatusPresentation {
  if (!user.enabled) return DISABLED_STATUS;
  return STATUS_BY_CODE[user.status] ?? STATUS_BY_CODE.UNKNOWN;
}

export const STATUS_BADGE_CLASS: Readonly<Record<StatusKind, string>> = {
  active: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  disabled: 'bg-red-50 text-red-700',
  attention: 'bg-gray-100 text-gray-700',
};

/** Invited but never signed in: Cognito refuses a password reset, so the invite is resent instead. */
export function isPendingInvite(user: Pick<CognitoUser, 'status'>): boolean {
  return user.status === 'FORCE_CHANGE_PASSWORD';
}

/** Whether `user` is the signed-in account, matched case-insensitively on username or email. */
export function isSignedInUser(user: Pick<CognitoUser, 'username' | 'email'>, identities: ReadonlySet<string>): boolean {
  return identities.has(user.username.toLowerCase()) || identities.has(user.email.toLowerCase());
}
