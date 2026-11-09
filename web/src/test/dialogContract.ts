/**
 * The behaviour every detail dialog built on `ui/Modal` shares, as one
 * parametrised suite: it is a modal dialog with an accessible name, and
 * Escape, the header close button and the dialog's own close buttons each
 * call `onClose` once.
 *
 * A dialog spec calls `describeDialogContract` with a render function that
 * returns the `onClose` spy, and adds only the tests specific to that dialog.
 */
import {
  describe, expect, it, type Mock
} from 'vitest';
import {
  fireEvent, screen
} from '@testing-library/react';

export interface DialogContract {
  /** The dialog's accessible name. */
  readonly name: string;
  /** Renders the open dialog and returns its `onClose` spy. */
  readonly render: () => Mock;
  /** Names of the dialog's own buttons that close it, besides the header close button. */
  readonly closeButtons?: readonly string[];
}

export function describeDialogContract({
  name, render, closeButtons = []
}: DialogContract) {
  describe('dialog behaviour', () => {
    it('opens a modal dialog with its accessible name', () => {
      render();

      expect(screen.getByRole('dialog', { name })).toHaveAttribute('aria-modal', 'true');
    });

    it('closes on Escape', () => {
      const onClose = render();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each(['Close modal', ...closeButtons])('closes from the %s button', (buttonName) => {
      const onClose = render();

      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
}
