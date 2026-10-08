import { vi } from 'vitest';
import type { ComponentProps } from 'react';
import {
  act, fireEvent, render, screen, within
} from '@testing-library/react';
import type { UserActionOutcome } from '../../hooks/useUserManagement';
import { mockUsers } from '../../hooks/useUserManagement-fixtures';
import { InviteModal } from './UserModals';
import { UserDetailsModal } from './UserDetailsModal';

type DetailsProps = ComponentProps<typeof UserDetailsModal>;

const succeeded = (): Promise<UserActionOutcome> => Promise.resolve({ success: true });

/** An action mock that answers an unsuccessful outcome with `message`. */
export function mockFailedAction(message: string) {
  return vi.fn((): Promise<UserActionOutcome> => Promise.resolve({
    success: false,
    message,
  }));
}

/** An action mock whose outcome never arrives, to observe the in-flight state. */
export function mockPendingAction() {
  return vi.fn((): Promise<UserActionOutcome> => new Promise(vi.fn()));
}

/** Renders the invite modal with a succeeding `onInvite` unless `overrides` say otherwise; returns its props. */
export function renderInviteModal(overrides: Partial<ComponentProps<typeof InviteModal>> = {}) {
  const props: ComponentProps<typeof InviteModal> = {
    onClose: vi.fn(),
    onInvite: vi.fn(succeeded),
    ...overrides,
  };
  render(<InviteModal {...props} />);
  return props;
}

/** Renders the manage dialog of user2 (an active Member, not the signed-in admin) with succeeding actions; returns its props. */
export function renderUserDetailsModal(overrides: Partial<DetailsProps> = {}) {
  const props: DetailsProps = {
    user: mockUsers[1],
    isSelf: false,
    onClose: vi.fn(),
    onSaveRole: vi.fn(succeeded),
    onSetEnabled: vi.fn(succeeded),
    onResetPassword: vi.fn(succeeded),
    onDelete: vi.fn(succeeded),
    ...overrides,
  };
  return {
    props,
    ...render(<UserDetailsModal {...props} />),
  };
}

/** Clicks `element` and lets the action it starts settle. */
export async function clickAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** The confirmation stacked on top of the manage dialog. */
export function getConfirmDialogElement(): HTMLElement {
  const dialogs = screen.getAllByRole('dialog');
  if (dialogs.length < 2) throw new TypeError('No confirmation is open');
  return dialogs[dialogs.length - 1];
}

/** Clicks `trigger` in the manage dialog, then `confirm` (default: the same label) in the confirmation it opens. */
export async function runConfirmedAction(trigger: string, confirm = trigger): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: trigger }));
  await clickAndSettle(within(getConfirmDialogElement()).getByRole('button', { name: confirm }));
}

/** Flips the "Can sign in" switch off and confirms. */
export async function disableAccess(): Promise<void> {
  fireEvent.click(screen.getByRole('switch', { name: 'Can sign in' }));
  await clickAndSettle(within(getConfirmDialogElement()).getByRole('button', { name: 'Disable access' }));
}

/** Picks `role` in the radio cards inside `container`. */
export function pickRole(role: 'Admin' | 'Member', container: HTMLElement = document.body): void {
  fireEvent.click(within(container).getByRole('radio', { name: new RegExp(`^${role}`, 'u') }));
}

/** Picks `role` inside `container` and saves it. */
export async function saveRole(role: 'Admin' | 'Member', container: HTMLElement = document.body): Promise<void> {
  pickRole(role, container);
  await clickAndSettle(within(container).getByRole('button', { name: 'Save role' }));
}

/** Types `email` into the invite form inside `container`. */
export function typeInviteEmail(email: string, container: HTMLElement = document.body): void {
  fireEvent.change(within(container).getByLabelText('Email address'), { target: { value: email } });
}

/** A focused button outside any dialog, standing in for the control that opened it. */
export function setupFocusedOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  return opener;
}
