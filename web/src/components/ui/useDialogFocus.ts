import {
  useEffect, useRef, type RefObject
} from 'react';

/*
 * Keyboard focus for `ui/Modal`: on open, focus moves into the dialog; while it is
 * the top-most open dialog, Tab and Shift+Tab stay inside it; on close, focus goes
 * back to the element that had it when the dialog opened. Dialogs can stack (a
 * confirmation over a details dialog), and only the one opened last traps Tab.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Open dialogs in the order they opened; the last one is on top. */
const openDialogs: HTMLElement[] = [];

function topDialog(): HTMLElement | undefined {
  return openDialogs[openDialogs.length - 1];
}

/** False for controls the user can't reach: disabled (also by a disabled `<fieldset>`), hidden by CSS or inside a collapsed `<details>`. */
function isReachable(element: HTMLElement): boolean {
  if (element.matches(':disabled')) return false;
  // Everything in a collapsed <details> except its <summary> is out of reach.
  if (element.closest('details:not([open]) > :not(summary)') !== null) return false;
  // jsdom has no layout, so it lacks `checkVisibility`; treat everything there as visible.
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isReachable);
}

/** Focuses `preferred`, else the first control, else the dialog itself; keeps focus already inside. */
function focusInto(dialog: HTMLElement, preferred: HTMLElement | null): void {
  if (dialog.contains(document.activeElement)) return;
  (preferred ?? focusablesIn(dialog)[0] ?? dialog).focus();
}

/** Keeps Tab and Shift+Tab cycling through the dialog's controls. */
function trapTab(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusables = focusablesIn(dialog);
  if (focusables.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const leaving = event.shiftKey ? document.activeElement === first : document.activeElement === last;
  if (leaving || !dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/**
 * Hands focus back after `dialog` closes: to `opener` when it is still on the page,
 * else into the dialog now on top. Leaves focus alone if something outside the
 * closed dialog already took it on purpose.
 */
function restoreFocus(dialog: HTMLElement, opener: Element | null): void {
  const active = document.activeElement;
  const focusLost = active === null || active === document.body || dialog.contains(active);
  if (!focusLost) return;
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus();
    return;
  }
  const top = topDialog();
  if (top !== undefined) focusInto(top, null);
}

/**
 * Focus management for a dialog element rendered while `isOpen`. `initialFocus`
 * names the control to focus on open; without it the first control gets focus,
 * and a dialog with no controls is focused itself (it needs `tabIndex={-1}`).
 */
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  // The opener is read during render, before React applies any `autoFocus` inside the dialog.
  const openerRef = useRef<Element | null>(null);
  const wasOpenRef = useRef(false);
  if (isOpen !== wasOpenRef.current) {
    wasOpenRef.current = isOpen;
    if (isOpen) openerRef.current = document.activeElement;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || dialog === null) return undefined;
    const opener = openerRef.current;
    openDialogs.push(dialog);
    focusInto(dialog, initialFocus?.current ?? null);
    const handleTab = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && topDialog() === dialog) trapTab(event, dialog);
    };
    document.addEventListener('keydown', handleTab);
    return () => {
      document.removeEventListener('keydown', handleTab);
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      restoreFocus(dialog, opener);
    };
  }, [dialogRef, isOpen, initialFocus]);
}
