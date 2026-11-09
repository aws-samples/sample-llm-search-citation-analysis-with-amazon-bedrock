import type { ReactNode } from 'react';
import {
  Button, CheckIcon, CloseIcon
} from '../ui';

interface SuggestionPanelProps {
  readonly title: ReactNode;
  /** The model's notes, shown under the title. */
  readonly notes: string | undefined;
  /** Set when the request failed; replaces the content. */
  readonly error?: string;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}

/**
 * Frame of a Bedrock suggestion panel (sub-brand expansion, competitor
 * discovery): a neutral box with the title, the model's notes, a dismiss
 * button and the panel's content.
 */
export function SuggestionPanel({
  title, notes, error, onDismiss, children
}: SuggestionPanelProps) {
  return (
    <section aria-label="Suggestions" className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          {notes && <p className="mt-1 text-sm text-gray-600 break-words">{notes}</p>}
        </div>
        <Button variant="iconOnly" size="sm" aria-label="Dismiss" onClick={() => onDismiss()}>
          <CloseIcon className="h-4 w-4" />
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700">Could not get suggestions: {error}</p> : children}
    </section>
  );
}

const CHIP_BASE = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-400';
const CHIP_SELECTED = 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400';
const CHIP_IDLE = 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100';
const CHIP_ADDED = 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed';

/** Picking suggested brands, then adding the picked ones or dismissing the panel. */
export interface PendingBrandSelectionProps {
  readonly pendingBrands: string[];
  readonly onToggleBrand: (brand: string) => void;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
}

interface SuggestionChipsProps extends PendingBrandSelectionProps {
  readonly suggestions: readonly string[];
  /** Suggestions already in the list: shown ticked and disabled. */
  readonly isAdded?: (brand: string) => boolean;
  /** Shown instead of the chips when there is nothing to suggest. */
  readonly emptyText: string;
}

/** The suggested names as toggle chips (none picked at first), then "Add N selected" and "Cancel". */
export function SuggestionChips({
  suggestions, pendingBrands, isAdded = () => false, onToggleBrand, onAccept, onCancel, emptyText
}: SuggestionChipsProps) {
  if (suggestions.length === 0) return <p className="text-sm text-gray-600">{emptyText}</p>;
  return (
    <>
      <p className="mb-2 text-sm text-gray-600">Pick the ones to add:</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {suggestions.map((brand) => {
          const added = isAdded(brand);
          const selected = pendingBrands.includes(brand);
          const tone = selected ? CHIP_SELECTED : CHIP_IDLE;
          return (
            <button
              key={brand}
              type="button"
              aria-pressed={added ? undefined : selected}
              disabled={added}
              onClick={() => onToggleBrand(brand)}
              className={`${CHIP_BASE} ${added ? CHIP_ADDED : tone}`}
            >
              {brand}
              {added && <CheckIcon className="h-3.5 w-3.5" title="Already added" />}
              {selected && <CheckIcon className="h-3.5 w-3.5" />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onAccept()} disabled={pendingBrands.length === 0}>
          Add {pendingBrands.length} selected
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onCancel()}>Cancel</Button>
      </div>
    </>
  );
}
