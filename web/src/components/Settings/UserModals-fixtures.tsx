import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import {
  mockGroups, mockUsers
} from '../../hooks/useUserManagement-fixtures';
import {
  InviteModal, UserDetailsModal
} from './UserModals';

/** Renders the invite modal over the Admins and Users groups unless `overrides` say otherwise; returns its props. */
export function renderInviteModal(overrides: Partial<ComponentProps<typeof InviteModal>> = {}) {
  const props: ComponentProps<typeof InviteModal> = {
    groups: mockGroups,
    onClose: vi.fn(),
    onInvite: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  render(<InviteModal {...props} />);
  return props;
}

/** Renders the details of user1 (enabled, in Admins) over the Admins and Users groups unless `overrides` say otherwise; returns its props. */
export function renderUserDetailsModal(overrides: Partial<ComponentProps<typeof UserDetailsModal>> = {}) {
  const props: ComponentProps<typeof UserDetailsModal> = {
    user: mockUsers[0],
    groups: mockGroups,
    onClose: vi.fn(),
    onUpdate: vi.fn(() => Promise.resolve()),
    onResetPassword: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  render(<UserDetailsModal {...props} />);
  return props;
}

/** The switch that enables or disables the account. */
export function getAccountSwitchElement(): HTMLElement {
  const label = screen.getByText('Account Enabled').closest('label');
  if (label === null) throw new TypeError('The account switch has no label');
  return within(label).getByRole('button');
}
