import { Button } from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import { CHECK_PATHS } from '../ui/iconPaths';

interface SaveBarProps {
  readonly dirty: boolean;
  readonly saving: boolean;
  /** A save just completed; shown for a moment once nothing is left to save. */
  readonly saved: boolean;
  /** The last save failed: the changes are still unsaved. */
  readonly failed?: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}

/**
 * The bar stuck to the bottom of the form while there is something to save:
 * "You have unsaved changes", Discard and Save changes. After a save it says
 * so for a moment, then goes away.
 */
export function SaveBar({
  dirty, saving, saved, failed = false, onSave, onDiscard
}: SaveBarProps) {
  if (!dirty && !saving && !saved) return null;
  return (
    <section
      aria-label="Save changes"
      className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-6 flex flex-wrap items-center justify-end gap-3 rounded-b-lg border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.15)] dark:bg-gray-800 sm:-mx-6 sm:-mb-6 sm:px-6"
    >
      {dirty || saving ? (
        <>
          <p className={`mr-auto text-sm font-medium ${failed ? 'text-red-700' : 'text-gray-900'}`} aria-live="polite">
            {failed ? 'Could not save your changes. Try again.' : 'You have unsaved changes'}
          </p>
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </>
      ) : (
        <p className="mr-auto flex items-center gap-1.5 text-sm font-medium text-emerald-700" aria-live="polite">
          <StrokeIcon className="h-4 w-4" paths={CHECK_PATHS} strokeWidth={2} />
          Changes saved
        </p>
      )}
    </section>
  );
}
