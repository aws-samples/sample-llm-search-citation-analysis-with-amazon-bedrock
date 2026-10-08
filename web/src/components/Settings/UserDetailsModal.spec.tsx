import {
  describe, expect, it
} from 'vitest';
import type { ComponentProps } from 'react';
import {
  fireEvent, screen, within
} from '@testing-library/react';
import { buildUser } from '../../hooks/useUserManagement-fixtures';
import {
  clickAndSettle, disableAccess, getConfirmDialogElement, mockFailedAction, mockPendingAction, pickRole,
  renderUserDetailsModal, runConfirmedAction, saveRole, setupFocusedOpener
} from './UserModals-fixtures';
import type { UserDetailsModal } from './UserDetailsModal';

type DetailsProps = Partial<ComponentProps<typeof UserDetailsModal>>;

const pendingUser = buildUser({ status: 'FORCE_CHANGE_PASSWORD' });

describe('UserDetailsModal', () => {
  const memberRadio = () => screen.getByRole('radio', { name: /^Member/u });
  const accessSwitch = () => screen.getByRole('switch', { name: 'Can sign in' });
  const resetPassword = () => runConfirmedAction('Reset password');
  const deleteUser = () => runConfirmedAction('Delete user');
  const saveAdmin = () => saveRole('Admin');

  describe('as a dialog', () => {
    it('is a modal dialog named after the email', () => {
      renderUserDetailsModal();

      expect(screen.getByRole('dialog', { name: 'user2@example.com' })).toHaveAttribute('aria-modal', 'true');
    });

    it('closes on Escape', () => {
      const { props } = renderUserDetailsModal();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(props.onClose).toHaveBeenCalledWith();
    });

    it('moves focus to its first control when it opens', () => {
      renderUserDetailsModal();

      expect(memberRadio()).toHaveFocus();
    });

    it('wraps Tab from the last control back to the first', () => {
      renderUserDetailsModal();
      screen.getByRole('button', { name: 'Close modal' }).focus();

      fireEvent.keyDown(document, { key: 'Tab' });

      expect(memberRadio()).toHaveFocus();
    });

    it('returns focus to the control that opened it when it closes', () => {
      const opener = setupFocusedOpener();
      const { unmount } = renderUserDetailsModal();

      unmount();

      expect(opener).toHaveFocus();
      opener.remove();
    });

    it('shows a pending invite as "Invite pending" with its hint', () => {
      renderUserDetailsModal({ user: pendingUser });

      expect(screen.getByText('Invite pending')).toBeInTheDocument();
      expect(screen.getByText("Hasn't signed in yet")).toBeInTheDocument();
    });
  });

  describe('role', () => {
    it('keeps Save role disabled until another role is picked', () => {
      renderUserDetailsModal();

      expect(screen.getByRole('button', { name: 'Save role' })).toBeDisabled();
    });

    it('says Saving… while the role is being saved', () => {
      renderUserDetailsModal({ onSaveRole: mockPendingAction() });
      pickRole('Admin');

      fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    });
  });

  describe('access', () => {
    it('shows sign-in access as a checked switch', () => {
      renderUserDetailsModal();

      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    it('asks for confirmation naming the email before disabling', () => {
      const { props } = renderUserDetailsModal();

      fireEvent.click(accessSwitch());

      expect(within(getConfirmDialogElement()).getByText(/^user2@example\.com won't be able to sign in/u)).toBeInTheDocument();
      expect(props.onSetEnabled).not.toHaveBeenCalledWith(false);
    });

    it('closes only the confirmation on Escape', () => {
      const { props } = renderUserDetailsModal();
      fireEvent.click(accessSwitch());

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(props.onClose).not.toHaveBeenCalledWith();
    });

    it('moves focus into the confirmation when it opens', () => {
      renderUserDetailsModal();

      fireEvent.click(accessSwitch());

      expect(within(getConfirmDialogElement()).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
  });

  describe('password', () => {
    it('offers Resend invite instead of Reset password while the invite is pending', () => {
      renderUserDetailsModal({ user: pendingUser });

      expect(screen.getByRole('button', { name: 'Resend invite' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
    });
  });

  describe('delete', () => {
    it('asks for confirmation naming the email', () => {
      renderUserDetailsModal();

      fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));

      expect(within(getConfirmDialogElement()).getByText(/^user2@example\.com will lose access/u)).toBeInTheDocument();
    });

    it('does not delete when the confirmation is cancelled', async () => {
      const { props } = renderUserDetailsModal();

      await runConfirmedAction('Delete user', 'Cancel');

      expect(props.onDelete).not.toHaveBeenCalledWith();
    });
  });

  describe('action requests', () => {
    it.each<[action: string, overrides: DetailsProps, run: () => Promise<void>, prop: keyof DetailsProps, args: unknown[]]>([
      ['saving the Admin role', {}, saveAdmin, 'onSaveRole', ['admin']],
      ['confirming Disable access', {}, disableAccess, 'onSetEnabled', [false]],
      ['enabling a disabled account', { user: buildUser({ enabled: false }) }, () => clickAndSettle(accessSwitch()), 'onSetEnabled', [true]],
      ['confirming Reset password', {}, resetPassword, 'onResetPassword', []],
      ['confirming Resend invite', { user: pendingUser }, () => runConfirmedAction('Resend invite'), 'onResetPassword', []],
      ['confirming Delete user', {}, deleteUser, 'onDelete', []],
    ])('calls the action on %s', async (_action, overrides, run, prop, args) => {
      const { props } = renderUserDetailsModal(overrides);

      await run();

      expect(props[prop]).toHaveBeenCalledWith(...args);
    });

    it.each<[text: string, overrides: DetailsProps, run: () => Promise<void>]>([
      ['Role changed to Admin.', {}, saveAdmin],
      ['Access disabled. They can no longer sign in.', {}, disableAccess],
      ['Password reset email sent.', {}, resetPassword],
      ['Invitation email sent again.', { user: pendingUser }, () => runConfirmedAction('Resend invite')],
    ])('says "%s" inside the dialog on success', async (text, overrides, run) => {
      renderUserDetailsModal(overrides);

      await run();

      expect(screen.getByRole('status')).toHaveTextContent(text);
    });

    it.each<[message: string, overrides: DetailsProps, run: () => Promise<void>]>([
      ['Failed to update user', { onSaveRole: mockFailedAction('Failed to update user') }, saveAdmin],
      ['Failed to disable', { onSetEnabled: mockFailedAction('Failed to disable') }, disableAccess],
      ['Failed to reset password', { onResetPassword: mockFailedAction('Failed to reset password') }, resetPassword],
      ['Failed to delete user', { onDelete: mockFailedAction('Failed to delete user') }, deleteUser],
    ])('shows "%s" inside the dialog and stays open', async (message, overrides, run) => {
      const { props } = renderUserDetailsModal(overrides);

      await run();

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(props.onClose).not.toHaveBeenCalledWith();
    });
  });

  describe('on the signed-in admin\'s own account', () => {
    it('explains why role and removal are locked', () => {
      renderUserDetailsModal({ isSelf: true });

      expect(screen.getByText("This is your account. You can't change your own role or remove yourself.")).toBeInTheDocument();
    });

    it('locks the role choice and the access switch', () => {
      renderUserDetailsModal({ isSelf: true });

      expect(screen.getByRole('radio', { name: /^Admin/u })).toBeDisabled();
      expect(accessSwitch()).toBeDisabled();
    });

    it.each(['Save role', 'Delete user'])('offers no %s button', (name) => {
      renderUserDetailsModal({ isSelf: true });

      expect(screen.queryAllByRole('button', { name })).toStrictEqual([]);
    });
  });
});
