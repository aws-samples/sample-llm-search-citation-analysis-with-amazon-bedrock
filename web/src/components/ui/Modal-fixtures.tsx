import type { ComponentProps } from 'react';
import {
  fireEvent, render
} from '@testing-library/react';
import { vi } from 'vitest';
import {
  AlertModal, ConfirmModal, Modal
} from './Modal';

type ModalProps = ComponentProps<typeof Modal>;
type ConfirmModalProps = ComponentProps<typeof ConfirmModal>;
type AlertModalProps = ComponentProps<typeof AlertModal>;

/** An open modal with placeholder content; overrides replace any prop, children included. */
export function modalElement(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    isOpen: true,
    onClose: vi.fn(),
    children: <p>Content</p>,
    ...overrides,
  };
  return <Modal {...props} />;
}

/** Renders `modalElement` wired to a fresh `onClose` spy and returns the spy with the render result. */
export function renderModal(overrides: Partial<ModalProps> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(modalElement({
      onClose,
      ...overrides,
    })),
  };
}

/** Renders an open confirm dialog wired to fresh `onClose` / `onConfirm` spies and returns them. */
export function renderConfirmModal(overrides: Partial<ConfirmModalProps> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmModal
      isOpen={true}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Confirm"
      message="Proceed?"
      {...overrides}
    />
  );
  return {
    onClose,
    onConfirm,
  };
}

/** Renders an open alert dialog wired to a fresh `onClose` spy and returns the spy with the render result. */
export function renderAlertModal(overrides: Partial<AlertModalProps> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <AlertModal
        isOpen={true}
        onClose={onClose}
        title="Info"
        message="Note this"
        {...overrides}
      />
    ),
  };
}

/** A focused button outside any dialog, standing in for the control that opened it. */
export function setupFocusedOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  return opener;
}

/** Dialog content with three buttons; the header close button follows them as the last control. */
export const THREE_BUTTONS = (
  <>
    <button type="button">First</button>
    <button type="button">Middle</button>
    <button type="button">Last</button>
  </>
);

/** Presses Tab (or Shift+Tab) on the document, where the dialog's focus trap listens. */
export function pressTab(shiftKey = false): void {
  fireEvent.keyDown(document, {
    key: 'Tab',
    shiftKey,
  });
}

/**
 * Renders a dialog with `THREE_BUTTONS` and a closed "Confirm" dialog after it, and
 * returns functions that open and close the Confirm dialog stacked over the first.
 */
export function renderStackedDialogs() {
  const lower = modalElement({ children: THREE_BUTTONS });
  const { rerender } = render(<>{lower}{modalElement({ isOpen: false })}</>);
  return {
    openTop: () => rerender(<>{lower}{modalElement({ title: 'Confirm' })}</>),
    closeTop: () => rerender(<>{lower}{modalElement({ isOpen: false })}</>),
  };
}
