import {
  useId, type KeyboardEvent, type ReactNode
} from 'react';
import { CloseIcon } from '../ui';

/** `brand` tints the chips violet (the tracked brand); `neutral` keeps them grey. */
type ChipTone = 'brand' | 'neutral';

const CHIP_TONE: Record<ChipTone, string> = {
  brand: 'bg-violet-50 text-violet-800 border-violet-200',
  neutral: 'bg-gray-100 text-gray-800 border-gray-200',
};

const FIELD_VARIANT = {
  boxed: 'min-h-[2.5rem] border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-700',
  inline: 'min-h-[2.25rem] border-transparent hover:border-gray-300 dark:hover:border-gray-600',
} as const;

interface TagChipProps {
  readonly label: string;
  readonly tone: ChipTone;
  readonly mono?: boolean;
  /** Accessible name of the remove button. */
  readonly removeLabel: string;
  readonly onRemove: () => void;
}

/** One value as a chip with a "×" that removes it. */
function TagChip({
  label, tone, mono = false, removeLabel, onRemove
}: TagChipProps) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-sm ${CHIP_TONE[tone]} ${mono ? 'font-mono' : ''}`}>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="rounded-full p-0.5 opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

interface TagInputProps {
  /** The values already added; none for a plain "add" box. */
  readonly items?: readonly string[];
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  /** Adds the draft; the owner validates, normalises and clears it. */
  readonly onCommit: () => void;
  readonly onRemove?: (item: string) => void;
  readonly removeLabel?: (item: string) => string;
  readonly inputId?: string;
  /** Accessible name of the text box. */
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly tone?: ChipTone;
  readonly mono?: boolean;
  readonly disabled?: boolean;
  /** Ties the box to a visible helper line. */
  readonly describedBy?: string;
  /** `boxed` looks like a text field; `inline` shows its border only on hover and focus, for dense rows. */
  readonly variant?: 'boxed' | 'inline';
  /** Further chips after the values (for example suggestions to pick). */
  readonly children?: ReactNode;
}

/**
 * A field of chips with a text box at the end: Enter or a comma adds what was
 * typed, "×" removes a chip, and an "Add" button shows once there is text, for
 * whoever does not reach for Enter.
 */
export function TagInput({
  items = [], draft, onDraftChange, onCommit, onRemove, removeLabel, inputId, inputLabel, placeholder,
  tone = 'neutral', mono = false, disabled = false, describedBy, variant = 'boxed', children
}: TagInputProps) {
  const generatedId = useId();
  const boxId = inputId ?? generatedId;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') return;
    event.preventDefault();
    onCommit();
  };

  return (
    // A <label> for the text box, so a click on the empty part of the field lands in it.
    <label htmlFor={boxId} className={`flex cursor-text flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600 dark:focus-within:border-blue-400 dark:focus-within:ring-blue-400 ${FIELD_VARIANT[variant]}`}>
      {items.map((item) => (
        <TagChip key={item} label={item} tone={tone} mono={mono} removeLabel={removeLabel?.(item) ?? `Remove ${item}`} onRemove={() => onRemove?.(item)} />
      ))}
      {children}
      <input
        id={boxId}
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={inputLabel}
        aria-describedby={describedBy}
        className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-gray-900 shadow-none outline-none ring-0 placeholder:text-gray-500 focus:outline-none focus:ring-0 !bg-transparent"
      />
      {draft.trim() !== '' && !disabled && (
        <button
          type="button"
          onClick={() => onCommit()}
          className="rounded-md px-2 py-0.5 text-sm font-medium text-blue-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Add
        </button>
      )}
    </label>
  );
}
