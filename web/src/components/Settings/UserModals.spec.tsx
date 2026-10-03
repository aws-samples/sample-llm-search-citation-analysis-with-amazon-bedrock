import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, fireEvent, screen
} from '@testing-library/react';
import {
  getAccountSwitchElement, renderInviteModal, renderUserDetailsModal
} from './UserModals-fixtures';
import { mockUsers } from '../../hooks/useUserManagement-fixtures';

class InviteRefusedError extends Error {
  constructor() {
    super('User already exists');
    this.name = 'InviteRefusedError';
  }
}

describe('InviteModal', () => {
  it.each([
    ['no email is typed', ''],
    ['the email is only whitespace', '   '],
  ])('keeps Send Invite disabled while %s', (_condition, email) => {
    renderInviteModal();

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: email } });

    expect(screen.getByRole('button', { name: 'Send Invite' })).toBeDisabled();
  });

  it('lists every group with its description', () => {
    renderInviteModal();

    expect(screen.getByRole('checkbox', { name: /Admins/u })).toBeInTheDocument();
    expect(screen.getByText('- Regular users')).toBeInTheDocument();
  });

  it('offers no group choice when there are no groups', () => {
    renderInviteModal({ groups: [] });

    expect(screen.queryByText('Groups (optional)')).not.toBeInTheDocument();
  });

  it('invites the trimmed email into the ticked groups and closes', async () => {
    const props = renderInviteModal();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: '  new@example.com ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Users/u }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
    });

    expect(props.onInvite).toHaveBeenCalledWith('new@example.com', ['Users']);
    expect(props.onClose).toHaveBeenCalledWith();
  });

  it.each([
    ['the refusal message', new InviteRefusedError(), 'User already exists'],
    ['the fallback message for a non-Error rejection', 'offline', 'Failed to invite user'],
  ])('shows %s and stays open when the invite fails', async (_message, rejection, shown) => {
    const props = renderInviteModal({ onInvite: vi.fn(() => Promise.reject(rejection)) });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'new@example.com' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
    });

    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalledWith();
  });
});

describe('UserDetailsModal', () => {
  it.each([
    ['Yes', true],
    ['No', false],
  ])('says %s under Email Verified', (answer, verified) => {
    renderUserDetailsModal({
      user: {
        ...mockUsers[0],
        email_verified: verified,
      },
    });

    expect(screen.getByText('Email Verified').nextElementSibling).toHaveTextContent(answer);
  });

  it('labels a disabled account as Disabled', () => {
    renderUserDetailsModal({
      user: {
        ...mockUsers[0],
        enabled: false,
      },
    });

    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('keeps Save Changes disabled until something changes', () => {
    renderUserDetailsModal();

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('disables Save Changes again when the account switch is flipped back', () => {
    renderUserDetailsModal();
    fireEvent.click(getAccountSwitchElement());
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();

    fireEvent.click(getAccountSwitchElement());

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('saves the disabled account with its ticked groups and closes', async () => {
    const props = renderUserDetailsModal();
    fireEvent.click(getAccountSwitchElement());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Users' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    });

    expect(props.onUpdate).toHaveBeenCalledWith(false, ['Admins', 'Users']);
    expect(props.onClose).toHaveBeenCalledWith();
  });

  it('enables Save Changes when only the groups change', () => {
    renderUserDetailsModal();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Admins' }));

    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  });

  it('asks for confirmation on the first delete click without deleting', () => {
    const props = renderUserDetailsModal();

    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));

    expect(screen.getByText('Click again to confirm deletion. This cannot be undone.')).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalledWith();
  });

  it('deletes the user and closes on the confirming click', async () => {
    const props = renderUserDetailsModal();
    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    });

    expect(props.onDelete).toHaveBeenCalledWith();
    expect(props.onClose).toHaveBeenCalledWith();
  });

  it('sends a password reset without closing', async () => {
    const props = renderUserDetailsModal();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    });

    expect(props.onResetPassword).toHaveBeenCalledWith();
    expect(props.onClose).not.toHaveBeenCalledWith();
  });

  it('shows no group choice when there are no groups', () => {
    renderUserDetailsModal({ groups: [] });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
