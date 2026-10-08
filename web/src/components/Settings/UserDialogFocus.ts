import { useEffect } from 'react';

/*
 * Focus handling for the Users dialogs. `ui/Modal` closes on Escape and marks
 * itself modal, but leaves focus where it was; these hooks move focus into the
 * top-most open dialog, keep Tab inside it and hand focus back on close.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The open dialog rendered last, i.e. the one on top of any other. */
function topDialog(): HTMLDialogElement | null {
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
  return dialogs.item(dialogs.length - 1);
}

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** Focuses the first control of the top dialog unless focus is already inside it. */
function focusIntoTopDialog(): void {
  const dialog = topDialog();
  if (dialog === null || dialog.contains(document.activeElement)) return;
  focusablesIn(dialog)[0]?.focus();
}

function restoreFocus(target: Element | null): void {
  if (target instanceof HTMLElement && target.isConnected) target.focus();
}

/** Keeps Tab and Shift+Tab cycling through the top dialog's controls. */
function trapTab(event: KeyboardEvent): void {
  const dialog = event.key === 'Tab' ? topDialog() : null;
  if (dialog === null) return;
  const focusables = focusablesIn(dialog);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const leaving = event.shiftKey ? document.activeElement === first : document.activeElement === last;
  if (leaving || !dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/**
 * For a dialog that is mounted while open: focuses its first control, traps
 * Tab inside the top dialog, and returns focus to the opener on unmount.
 */
export function useDialogFocus(): void {
  useEffect(() => {
    const opener = document.activeElement;
    focusIntoTopDialog();
    document.addEventListener('keydown', trapTab);
    return () => {
      document.removeEventListener('keydown', trapTab);
      restoreFocus(opener);
    };
  }, []);
}

/**
 * For a confirmation stacked over the dialog: while `layer` is set, focus moves
 * into the new top dialog; when it clears, focus returns to the control that opened it.
 */
export function useStackedDialogFocus(layer: string | null): void {
  useEffect(() => {
    if (layer === null) return undefined;
    const opener = document.activeElement;
    focusIntoTopDialog();
    return () => restoreFocus(opener);
  }, [layer]);
}
