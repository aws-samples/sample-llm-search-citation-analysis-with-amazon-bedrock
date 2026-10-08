import { vi } from 'vitest';
import {
  fireEvent, screen, within
} from '@testing-library/react';
import type { useUserManagement } from '../../hooks/useUserManagement';
import {
  buildUser, mockUsers
} from '../../hooks/useUserManagement-fixtures';
import {
  clickAndSettle, pickRole, typeInviteEmail
} from './UserModals-fixtures';

type UserManagement = ReturnType<typeof useUserManagement>;

/** user1 (Admin, signed in), user2 (Member) and a pending Member invite. */
export const configUsers = [
  ...mockUsers,
  buildUser({
    username: 'user3',
    email: 'pending@example.com',
    status: 'FORCE_CHANGE_PASSWORD',
  }),
];

/** The loaded hook over `configUsers`, signed in as user1, with succeeding actions. */
export function buildUserManagementMock(overrides: Partial<UserManagement> = {}): UserManagement {
  return {
    users: configUsers,
    loading: false,
    refreshing: false,
    error: null,
    total: configUsers.length,
    signedInIdentity: new Set(['user1@example.com']),
    refresh: vi.fn(() => Promise.resolve()),
    invite: vi.fn(() => Promise.resolve({ success: true })),
    update: vi.fn(() => Promise.resolve({ success: true })),
    remove: vi.fn(() => Promise.resolve({ success: true })),
    resetPassword: vi.fn(() => Promise.resolve({ success: true })),
    ...overrides,
  };
}

/** The table row holding `email`. */
export function getRowElement(email: string): HTMLElement {
  const row = screen.getByText(email).closest('tr');
  if (row === null) throw new TypeError(`No row for ${email}`);
  return row;
}

/** Opens the manage dialog of `email` from its row. */
export function openManageDialog(email: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Manage ${email}` }));
  return screen.getByRole('dialog', { name: email });
}

/** Sends an invite to `email` as `role` through the invite dialog. */
export async function sendInvite(email: string, role: 'Member' | 'Admin'): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Invite user' }));
  const dialog = screen.getByRole('dialog', { name: 'Invite someone' });
  typeInviteEmail(email, dialog);
  pickRole(role, dialog);
  await clickAndSettle(within(dialog).getByRole('button', { name: 'Send invite' }));
}
