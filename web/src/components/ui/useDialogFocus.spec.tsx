import { createRef } from 'react';
import {
  render, screen, within
} from '@testing-library/react';
import {
  afterEach, describe, expect, it
} from 'vitest';
import {
  THREE_BUTTONS, modalElement, pressTab, renderModal, renderStackedDialogs, setupFocusedOpener
} from './Modal-fixtures';

describe('useDialogFocus (through ui/Modal)', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  afterEach(() => {
    document.body.replaceChildren();
  });

  describe('on open', () => {
    it('focuses the first control inside the dialog', () => {
      renderModal({ children: THREE_BUTTONS });

      expect(button('First')).toHaveFocus();
    });

    it('focuses the control named by initialFocus', () => {
      const initialFocus = createRef<HTMLButtonElement>();
      renderModal({
        initialFocus,
        children: <><button type="button">First</button><button type="button" ref={initialFocus}>Wanted</button></>,
      });

      expect(button('Wanted')).toHaveFocus();
    });

    it('focuses the dialog itself when it has no controls', () => {
      renderModal({ showCloseButton: false });

      expect(screen.getByRole('dialog')).toHaveFocus();
    });

    it('keeps an autoFocus control focused', () => {
      renderModal({ children: <><button type="button">First</button><input aria-label="Name" autoFocus /></> });

      expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    it('skips controls disabled by their fieldset', () => {
      renderModal({ children: <><fieldset disabled><input aria-label="Locked" /></fieldset><button type="button">Open</button></> });

      expect(button('Open')).toHaveFocus();
    });

    it('skips controls inside a collapsed details element', () => {
      renderModal({ children: <details><summary>More</summary><button type="button">Hidden</button></details> });
      button('Close modal').focus();

      pressTab();

      expect(screen.getByText('More')).toHaveFocus();
    });
  });

  describe('Tab trap', () => {
    it.each([
      ['Tab from the last control wraps to the first', 'Close modal', false, 'First'],
      ['Shift+Tab from the first control wraps to the last', 'First', true, 'Close modal'],
    ])('%s', (_title, from, shiftKey, to) => {
      renderModal({ children: THREE_BUTTONS });
      button(from).focus();

      pressTab(shiftKey);

      expect(button(to)).toHaveFocus();
    });

    it('pulls focus back in when Tab is pressed from outside the dialog', () => {
      renderModal({ children: THREE_BUTTONS });
      setupFocusedOpener();

      pressTab();

      expect(button('First')).toHaveFocus();
    });

    it('lets only the top dialog trap Tab when dialogs stack', () => {
      render(<>{modalElement({ children: THREE_BUTTONS })}{modalElement({
        title: 'Confirm',
        children: <button type="button">OK</button>,
      })}</>);
      const confirm = screen.getByRole('dialog', { name: 'Confirm' });
      within(confirm).getByRole('button', { name: 'Close modal' }).focus();

      pressTab();

      expect(within(confirm).getByRole('button', { name: 'OK' })).toHaveFocus();
    });
  });

  describe('on close', () => {
    it('returns focus to the element that opened the dialog', () => {
      const opener = setupFocusedOpener();
      const { rerender } = render(modalElement({ children: THREE_BUTTONS }));

      rerender(modalElement({
        children: THREE_BUTTONS,
        isOpen: false,
      }));

      expect(opener).toHaveFocus();
    });

    it('returns focus to the control in the lower dialog that opened a stacked one', () => {
      const {
        openTop, closeTop 
      } = renderStackedDialogs();
      button('Middle').focus();
      openTop();

      closeTop();

      expect(button('Middle')).toHaveFocus();
    });

    it('moves focus into the remaining dialog when the opener is gone', () => {
      const {
        openTop, closeTop 
      } = renderStackedDialogs();
      const opener = setupFocusedOpener();
      openTop();
      opener.remove();

      closeTop();

      expect(button('First')).toHaveFocus();
    });
  });
});
