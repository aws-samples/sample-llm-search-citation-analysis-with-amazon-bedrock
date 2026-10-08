import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  fireEvent, render, screen, within
} from '@testing-library/react';
import { UsersConfig } from './UsersConfig';
import { useUserManagement } from '../../hooks/useUserManagement';
import { buildUser } from '../../hooks/useUserManagement-fixtures';
import {
  buildUserManagementMock, getRowElement, openManageDialog, sendInvite
} from './UsersConfig-fixtures';
import {
  runConfirmedAction, saveRole
} from './UserModals-fixtures';

vi.mock('../../hooks/useUserManagement', () => ({ useUserManagement: vi.fn() }));

const mockUseUserManagement = vi.mocked(useUserManagement);

function renderUsersConfig(overrides: Parameters<typeof buildUserManagementMock>[0] = {}) {
  const hook = buildUserManagementMock(overrides);
  mockUseUserManagement.mockReturnValue(hook);
  render(<UsersConfig />);
  return hook;
}

describe('UsersConfig', () => {
  beforeEach(() => {
    mockUseUserManagement.mockReturnValue(buildUserManagementMock());
  });

  describe('header', () => {
    it('describes the section without Cognito jargon', () => {
      renderUsersConfig();

      expect(screen.getByText('Invite people and choose who can change settings.')).toBeInTheDocument();
    });

    it.each(['Refresh', 'Invite user'])('hides the decorative icon of the %s button from assistive technology', (name) => {
      renderUsersConfig();

      expect(screen.getByRole('button', { name }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('refreshes the list from the Refresh button', () => {
      const hook = renderUsersConfig();

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

      expect(hook.refresh).toHaveBeenCalledWith();
    });
  });

  describe('loading', () => {
    it('announces the first load as busy skeleton rows instead of the table', () => {
      renderUsersConfig({ loading: true });

      expect(screen.getByText('Loading users').closest('output')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('keeps the table while refreshing', () => {
      renderUsersConfig({ refreshing: true });

      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('says Refreshing… on the disabled Refresh button while refreshing', () => {
      renderUsersConfig({ refreshing: true });

      expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    });

    it('shows the load error', () => {
      renderUsersConfig({ error: 'Failed to list users' });

      expect(screen.getByText('Failed to list users')).toBeInTheDocument();
    });
  });

  describe('table', () => {
    it('does not show the raw Cognito username', () => {
      renderUsersConfig();

      expect(screen.queryByText('user2')).not.toBeInTheDocument();
    });

    it.each([
      ['user1@example.com', 'Admin'],
      ['user2@example.com', 'Member'],
    ])('shows %s with the %s role', (email, role) => {
      renderUsersConfig();

      expect(within(getRowElement(email)).getByText(role)).toBeInTheDocument();
    });

    it('marks the signed-in admin\'s row "You"', () => {
      renderUsersConfig();

      expect(within(getRowElement('user1@example.com')).getByText('You')).toBeInTheDocument();
      expect(within(getRowElement('user2@example.com')).queryByText('You')).not.toBeInTheDocument();
    });

    it('shows a pending invite as "Invite pending" with its hint', () => {
      renderUsersConfig();

      expect(within(getRowElement('pending@example.com')).getByText('Invite pending')).toBeInTheDocument();
      expect(within(getRowElement('pending@example.com')).getByText("Hasn't signed in yet")).toBeInTheDocument();
    });

    it('counts people and pending invites', () => {
      renderUsersConfig();

      expect(screen.getByText('3 people · 1 invite pending')).toBeInTheDocument();
    });

    it('invites the first user when there is nobody yet', () => {
      renderUsersConfig({
        users: [],
        total: 0,
      });

      expect(screen.getByText('No users yet. Invite someone to get started.')).toBeInTheDocument();
    });
  });

  describe('filters', () => {
    it('keeps only the rows whose email matches the search', () => {
      renderUsersConfig();

      fireEvent.change(screen.getByLabelText('Search by email'), { target: { value: 'pending' } });

      expect(screen.getAllByRole('row')).toHaveLength(2);
      expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
    });

    it('keeps only the role picked', () => {
      renderUsersConfig();

      fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'admin' } });

      expect(screen.queryByText('user2@example.com')).not.toBeInTheDocument();
    });

    it('says so when nobody matches', () => {
      renderUsersConfig();

      fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'disabled' } });

      expect(screen.getByText('No one matches these filters.')).toBeInTheDocument();
    });
  });

  describe('invite', () => {
    it('invites an Admin into both the Users and Admin groups', async () => {
      const hook = renderUsersConfig();

      await sendInvite('new@example.com', 'Admin');

      expect(hook.invite).toHaveBeenCalledWith({
        email: 'new@example.com',
        groups: ['Users', 'Admin'],
      });
    });

    it('confirms the invitation and when its password expires', async () => {
      renderUsersConfig();

      await sendInvite('new@example.com', 'Member');

      expect(screen.getByRole('status')).toHaveTextContent('Invitation sent to new@example.com. The temporary password expires in 7 days.');
    });

    it('passes on the warning when a group could not be assigned', async () => {
      renderUsersConfig({
        invite: vi.fn(() => Promise.resolve({
          success: true,
          warning: 'The invitation was sent, but the user could not be added to: Admin',
        })),
      });

      await sendInvite('new@example.com', 'Admin');

      expect(screen.getByRole('status')).toHaveTextContent('could not be added to: Admin. Open Manage for new@example.com to check their role.');
    });
  });

  describe('manage', () => {
    it('opens the manage dialog of the row', () => {
      renderUsersConfig();

      expect(openManageDialog('user2@example.com')).toBeInTheDocument();
    });

    it.each<[change: string, groups: string[], role: 'Admin' | 'Member', saved: string[]]>([
      ['a promotion to Admin as Users plus Admin', ['Users'], 'Admin', ['Users', 'Admin']],
      ['a demotion to Member as Users only', ['Admin'], 'Member', ['Users']],
    ])('saves %s', async (_change, groups, role, saved) => {
      const hook = renderUsersConfig({ users: [buildUser({ groups })] });

      await saveRole(role, openManageDialog('user2@example.com'));

      expect(hook.update).toHaveBeenCalledWith('user2', { groups: saved });
    });

    it('locks the signed-in admin\'s own account', () => {
      renderUsersConfig();

      const dialog = openManageDialog('user1@example.com');

      expect(within(dialog).getByText("This is your account. You can't change your own role or remove yourself.")).toBeInTheDocument();
    });

    it('closes the dialog and confirms once the user is deleted', async () => {
      renderUsersConfig();
      openManageDialog('user2@example.com');

      await runConfirmedAction('Delete user');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('user2@example.com was deleted.');
    });
  });
});
