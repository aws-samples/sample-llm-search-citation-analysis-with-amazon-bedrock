/**
 * Promotion controls for a single research result view: selection counter, the
 * add trigger, and the progress/success/error banner.
 *
 * No status or priority picker is offered: the request omits both fields and the
 * backend applies its documented `active` / `normal` defaults.
 *
 * The owning view creates the `usePromoteKeywords` instance (one per displayed
 * result) and passes it here, so each result keeps its own selection.
 */
import {
  SELECTION_LIMIT, promotionSuccessMessage
} from '../../hooks/usePromoteKeywords';
import type { UsePromoteKeywords } from '../../hooks/usePromoteKeywords';
import { Spinner } from '../ui/Spinner';

interface KeywordPromotionControlsProps {promotion: UsePromoteKeywords;}

export const KeywordPromotionControls = ({ promotion }: KeywordPromotionControlsProps) => {
  const {
    selectedCount,
    canPromote,
    submitting,
    error,
    limitMessage,
    outcome,
    promote,
  } = promotion;

  const startPromotion = () => {
    void promote();
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
        <p className="flex-1 text-sm text-gray-600">
          {selectedCount} of {SELECTION_LIMIT} keywords selected
        </p>

        <button
          type="button"
          onClick={startPromotion}
          disabled={!canPromote}
          className="w-full sm:w-auto px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              Adding...
            </>
          ) : 'Add to Keywords'}
        </button>
      </div>

      <output className="block space-y-2">
        {submitting && (
          <span className="flex items-center gap-2 text-sm text-gray-600">
            <Spinner size="sm" className="text-gray-400" />
            Adding selected keywords...
          </span>
        )}

        {limitMessage && <span className="block text-sm text-amber-700">{limitMessage}</span>}

        {/* Auto-dismissed by the hook a few seconds after the request succeeds. */}
        {outcome && (
          <span className="block text-sm text-green-700">{promotionSuccessMessage(outcome)}</span>
        )}
      </output>

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  );
};
