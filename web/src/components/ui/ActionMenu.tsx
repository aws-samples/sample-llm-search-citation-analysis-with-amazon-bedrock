import {
  useEffect, useId, useRef, useState, type KeyboardEvent
} from 'react';

export interface ActionMenuItem {
  /** The item's visible text, which is also its accessible name. */
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** `danger` colours a destructive item (delete) red. */
  readonly tone?: 'danger';
}

interface ActionMenuProps {
  /** The trigger's accessible name, e.g. "Actions for hotels". */
  readonly label: string;
  readonly items: readonly ActionMenuItem[];
  /** Extra classes for the trigger, e.g. to reveal it only on hover or focus inside a list row. */
  readonly triggerClassName?: string;
}

const ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-sm rounded-sm focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed';
const TONE_CLASS = {
  neutral: 'text-gray-700 hover:bg-gray-100 focus:bg-gray-100 dark:focus:bg-gray-600',
  danger: 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:focus:bg-red-900/40',
} as const;

/** Three horizontal dots, in the text colour of the trigger. */
const DotsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <circle cx="4" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="16" cy="10" r="1.5" />
  </svg>
);

function focusItem(menu: HTMLElement | null, step: 1 | -1 | 0): void {
  if (!menu) return;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = step === 0 || current === -1 ? 0 : (current + step + items.length) % items.length;
  items[next]?.focus();
}

/**
 * A "⋯" button that opens a short list of row actions, so a dense row shows
 * one control instead of many equal-weight buttons. Keyboard: Enter/Space
 * opens and focuses the first item, arrows move, Escape closes and returns
 * focus to the button, Tab closes. A click outside closes it too.
 */
export function ActionMenu({
  label, items, triggerClassName = ''
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    focusItem(menuRef.current, 0);
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(menuRef.current, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        className={`p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900 ${triggerClassName}`.trim()}
      >
        <DotsIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-20 mt-1 min-w-[11rem] p-1 bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { close(); item.onSelect(); }}
              className={`${ITEM_CLASS} ${TONE_CLASS[item.tone ?? 'neutral']}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
