import { useId } from 'react';
import {
  SELECTION_LIMIT, promotionSuccessMessage
} from '../../../hooks/usePromoteKeywords';
import type { KeywordExplorerTracking } from '../../../hooks/useKeywordExplorerTracking';
import { Button } from '../../ui/Button';
import { ErrorAlert } from '../../ui/ErrorAlert';

/** Selection count, destination group and the "Track keywords" action of the explorer. */
export function KeywordTrackBar({ tracking }: { readonly tracking: KeywordExplorerTracking }) {
  const groupSelectId = useId();
  const {
    promotion, groups, groupsLoading, groupId, chooseGroup
  } = tracking;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
        <p className="flex-1 text-sm text-gray-600">{`${promotion.selectedCount} selected (up to ${SELECTION_LIMIT})`}</p>
        <div className="w-full sm:w-56">
          <label htmlFor={groupSelectId} className="block text-xs text-gray-600 mb-1">Keyword group</label>
          <select
            id={groupSelectId}
            value={groupId}
            onChange={(event) => chooseGroup(event.target.value)}
            disabled={groupsLoading || promotion.submitting}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900"
          >
            <option value="">No group</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
        <Button onClick={() => { void promotion.promote(); }} disabled={!promotion.canPromote}>
          {promotion.submitting ? 'Tracking…' : 'Track keywords'}
        </Button>
      </div>
      <output className="block space-y-1 text-sm">
        {promotion.limitMessage && <span className="block text-amber-700">{promotion.limitMessage}</span>}
        {promotion.outcome && <span className="block text-green-700">{promotionSuccessMessage(promotion.outcome)}</span>}
      </output>
      <ErrorAlert message={promotion.error} />
    </div>
  );
}
