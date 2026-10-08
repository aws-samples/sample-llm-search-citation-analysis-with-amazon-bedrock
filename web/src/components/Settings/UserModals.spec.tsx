import {
  describe, expect, it
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';
import {
  clickAndSettle, mockFailedAction, mockPendingAction, pickRole, renderInviteModal, typeInviteEmail
} from './UserModals-fixtures';

describe('InviteModal', () => {
  const sendButton = () => screen.getByRole('button', { name: 'Send invite' });

  it('is a dialog named "Invite someone"', () => {
    renderInviteModal();

    expect(screen.getByRole('dialog', { name: 'Invite someone' })).toBeInTheDocument();
  });

  it('focuses the email field when it opens', () => {
    renderInviteModal();

    expect(screen.getByLabelText('Email address')).toHaveFocus();
  });

  it.each([
    ['no email is typed', ''],
    ['the email is only whitespace', '   '],
  ])('keeps Send invite disabled while %s', (_condition, email) => {
    renderInviteModal();

    typeInviteEmail(email);

    expect(sendButton()).toBeDisabled();
  });

  it('picks the Member role by default', () => {
    renderInviteModal();

    expect(screen.getByRole('radio', { name: /^Member/u })).toBeChecked();
  });

  it('explains that a temporary password is emailed and expires in 7 days', () => {
    renderInviteModal();

    expect(screen.getByText(/temporary password\. It expires after 7 days/u)).toBeInTheDocument();
  });

  it('invites the trimmed email with the role picked and closes', async () => {
    const props = renderInviteModal();
    typeInviteEmail('  new@example.com ');
    pickRole('Admin');

    await clickAndSettle(sendButton());

    expect(props.onInvite).toHaveBeenCalledWith('new@example.com', 'admin');
    expect(props.onClose).toHaveBeenCalledWith();
  });

  it('says Sending… on the submit button while the invite is in flight', () => {
    renderInviteModal({ onInvite: mockPendingAction() });
    typeInviteEmail('new@example.com');

    fireEvent.click(sendButton());

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  });

  it('shows the failure and stays open when the invite fails', async () => {
    const props = renderInviteModal({ onInvite: mockFailedAction('User with this email already exists') });
    typeInviteEmail('new@example.com');

    await clickAndSettle(sendButton());

    expect(screen.getByRole('alert')).toHaveTextContent('User with this email already exists');
    expect(props.onClose).not.toHaveBeenCalledWith();
  });

  it('closes from the Cancel button', () => {
    const props = renderInviteModal();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onClose).toHaveBeenCalledWith();
  });
});
