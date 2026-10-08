import {
  describe, expect, it
} from 'vitest';
import type { CognitoUser } from '../../api/users';
import {
  groupsForRole, isPendingInvite, isSignedInUser, roleOf, statusOf
} from './UserPresentation';

describe('roleOf', () => {
  it.each<[groups: string[], role: string]>([
    [['Admin'], 'admin'],
    [['Users', 'Admin'], 'admin'],
    [['Users'], 'member'],
    [[], 'member'],
  ])('reads %j as %s', (groups, role) => {
    expect(roleOf(groups)).toBe(role);
  });
});

describe('groupsForRole', () => {
  it('puts a Member in Users and out of Admin', () => {
    expect(groupsForRole(['Users', 'Admin'], 'member')).toStrictEqual(['Users']);
  });

  it('puts an Admin in both Users and Admin', () => {
    expect(groupsForRole([], 'admin')).toStrictEqual(['Users', 'Admin']);
  });

  it('keeps groups the role model does not own', () => {
    expect(groupsForRole(['Beta', 'Admin'], 'member')).toStrictEqual(['Beta', 'Users']);
  });

  it('lists Users once when the account is already in it', () => {
    expect(groupsForRole(['Users'], 'admin')).toStrictEqual(['Users', 'Admin']);
  });
});

describe('statusOf', () => {
  it.each<[status: CognitoUser['status'], label: string, hint: string]>([
    ['CONFIRMED', 'Active', 'Can sign in'],
    ['FORCE_CHANGE_PASSWORD', 'Invite pending', "Hasn't signed in yet"],
    ['RESET_REQUIRED', 'Password reset required', 'Must choose a new password at next sign-in'],
    ['UNCONFIRMED', 'Unconfirmed', "Hasn't confirmed their email address"],
  ])('labels an enabled %s account "%s"', (status, label, hint) => {
    expect(statusOf({
      status,
      enabled: true,
    })).toMatchObject({
      label,
      hint,
    });
  });

  it('labels a disabled account Disabled whatever its Cognito status', () => {
    expect(statusOf({
      status: 'FORCE_CHANGE_PASSWORD',
      enabled: false,
    })).toStrictEqual({
      kind: 'disabled',
      label: 'Disabled',
      hint: "Can't sign in",
    });
  });

  it('falls back to Unknown for a status the dashboard does not know', () => {
    const unexpected = String('NEW_STATE') as CognitoUser['status'];

    expect(statusOf({
      status: unexpected,
      enabled: true,
    }).label).toBe('Unknown');
  });
});

describe('isPendingInvite', () => {
  it.each<[status: CognitoUser['status'], pending: boolean]>([
    ['FORCE_CHANGE_PASSWORD', true],
    ['CONFIRMED', false],
    ['RESET_REQUIRED', false],
  ])('answers %s with %s', (status, pending) => {
    expect(isPendingInvite({ status })).toBe(pending);
  });
});

describe('isSignedInUser', () => {
  it('matches the email whatever its letter case', () => {
    expect(isSignedInUser({
      username: 'uuid-1',
      email: 'Me@Example.com',
    }, new Set(['me@example.com']))).toBe(true);
  });

  it('matches the Cognito username', () => {
    expect(isSignedInUser({
      username: 'UUID-1',
      email: 'me@example.com',
    }, new Set(['uuid-1']))).toBe(true);
  });

  it('does not match someone else', () => {
    expect(isSignedInUser({
      username: 'uuid-2',
      email: 'other@example.com',
    }, new Set(['me@example.com', 'uuid-1']))).toBe(false);
  });
});
