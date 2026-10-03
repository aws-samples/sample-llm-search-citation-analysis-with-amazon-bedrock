import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
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
