/**
 * Promotion controls for a single research result view: selection counter,
 * status/priority pickers, promote trigger, and the progress/outcome/error banner.
 *
 * The owning view creates the `usePromoteKeywords` instance (one per displayed
 * result) and passes it here, so each result keeps its own selection.
 */
import {
  useId, useState 
} from 'react';
import { SELECTION_LIMIT } from '../../hooks/usePromoteKeywords';
import type { UsePromoteKeywords } from '../../hooks/usePromoteKeywords';
import { Spinner } from '../ui/Spinner';

const PROMOTION_STATUSES = ['active', 'inactive', 'paused'];

const PROMOTION_PRIORITIES = ['high', 'normal', 'low'];

const SELECT_CLASSES =
  'w-full sm:w-auto px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-200';

interface KeywordPromotionControlsProps {promotion: UsePromoteKeywords;}

export const KeywordPromotionControls = ({ promotion }: KeywordPromotionControlsProps) => {
  const fieldPrefix = useId();
  const [status, setStatus] = useState('active');
  const [priority, setPriority] = useState('normal');

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
    void promote(status, priority);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
        <p className="flex-1 text-sm text-gray-600">
          {selectedCount} of {SELECTION_LIMIT} keywords selected
        </p>

        <div>
          <label htmlFor={`${fieldPrefix}-status`} className="block text-sm text-gray-600 mb-1">
            Status
          </label>
          <select
            id={`${fieldPrefix}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={SELECT_CLASSES}
          >
            {PROMOTION_STATUSES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${fieldPrefix}-priority`} className="block text-sm text-gray-600 mb-1">
            Priority
          </label>
          <select
            id={`${fieldPrefix}-priority`}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className={SELECT_CLASSES}
          >
            {PROMOTION_PRIORITIES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={startPromotion}
          disabled={!canPromote}
          className="w-full sm:w-auto px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              Promoting...
            </>
          ) : 'Promote selected'}
        </button>
      </div>

      <output className="block space-y-2">
        {submitting && (
          <span className="flex items-center gap-2 text-sm text-gray-600">
            <Spinner size="sm" className="text-gray-400" />
            Promoting selected keywords...
          </span>
        )}

        {limitMessage && <span className="block text-sm text-amber-700">{limitMessage}</span>}

        {outcome && (
          <span className="block text-sm text-gray-700">
            {outcome.created} created, {outcome.skipped} skipped
          </span>
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
