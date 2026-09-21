import { useState } from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';

interface KeywordGroupChipsProps {
  readonly keyword: Keyword;
  readonly groupsById: ReadonlyMap<string, KeywordGroup>;
}

/** The groups a keyword belongs to, as small chips after its text. */
export const KeywordGroupChips = ({
  keyword, groupsById 
}: KeywordGroupChipsProps) => {
  const names = (keyword.group_ids ?? [])
    .map((id) => groupsById.get(id)?.name)
    .filter((name): name is string => name !== undefined)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span key={name} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{name}</span>
      ))}
    </span>
  );
};

interface KeywordGroupMenuProps {
  readonly keyword: Keyword;
  readonly groups: KeywordGroup[];
  readonly busy: boolean;
  readonly onToggle: (group: KeywordGroup, member: boolean) => void;
  readonly onClose: () => void;
}

/** Checkbox list to add/remove one keyword from each group. */
export const KeywordGroupMenu = ({
  keyword, groups, busy, onToggle, onClose 
}: KeywordGroupMenuProps) => {
  const memberships = new Set(keyword.group_ids ?? []);
  return (
    <fieldset className="w-full mt-2 p-3 border border-gray-200 rounded-lg bg-gray-50">
      <legend className="sr-only">{`Groups for ${keyword.keyword}`}</legend>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-500">No groups yet. Create one above to start organising keywords.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
          {groups.map((group) => {
            const member = memberships.has(group.id);
            return (
              <label key={group.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={member}
                  disabled={busy}
                  onChange={() => onToggle(group, member)}
                  className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
                />
                <span className="text-sm text-gray-700 truncate">{group.name}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-end mt-2">
        <button type="button" onClick={onClose} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900">Done</button>
      </div>
    </fieldset>
  );
};

interface BulkGroupBarProps {
  readonly selectedCount: number;
  readonly groups: KeywordGroup[];
  readonly busy: boolean;
  readonly onAddToGroup: (group: KeywordGroup) => void;
  readonly onRemoveFromGroup: (group: KeywordGroup) => void;
  readonly onClearSelection: () => void;
  /** How many of the ticked keywords a run currently skips. */
  readonly pausedSelectedCount?: number;
  readonly onActivateSelected?: () => void;
  readonly onPauseSelected?: () => void;
}

/** Bulk membership and status actions for the keywords ticked in the list. */
export const BulkGroupBar = ({
  selectedCount, groups, busy, onAddToGroup, onRemoveFromGroup, onClearSelection,
  pausedSelectedCount = 0, onActivateSelected, onPauseSelected,
}: BulkGroupBarProps) => {
  const [groupId, setGroupId] = useState('');
  const chosen = groups.find((group) => group.id === groupId);
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm">
      <span className="text-gray-700 font-medium">{selectedCount} keyword{selectedCount === 1 ? '' : 's'} selected</span>
      <select
        aria-label="Group for selected keywords"
        value={groupId}
        onChange={(event) => setGroupId(event.target.value)}
        disabled={busy || groups.length === 0}
        className="px-3 py-1.5 border border-gray-200 rounded-lg bg-white text-sm"
      >
        <option value="">Choose a group...</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !chosen}
        onClick={() => { if (chosen) onAddToGroup(chosen); }}
        className="px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        Add to group
      </button>
      <button
        type="button"
        disabled={busy || !chosen}
        onClick={() => { if (chosen) onRemoveFromGroup(chosen); }}
        className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Remove from group
      </button>
      {onActivateSelected && (
        <button
          type="button"
          disabled={busy || pausedSelectedCount === 0}
          onClick={onActivateSelected}
          // The count is in the label because activating is the expensive
          // direction: each active keyword is queried against every provider on
          // the next run, so "Activate 40" should not be a silent click.
          title={pausedSelectedCount === 0 ? 'Every selected keyword is already active' : undefined}
          className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Activate{pausedSelectedCount > 0 ? ` ${pausedSelectedCount}` : ''}
        </button>
      )}
      {onPauseSelected && (
        <button
          type="button"
          disabled={busy}
          onClick={onPauseSelected}
          className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Pause
        </button>
      )}
      <button type="button" onClick={onClearSelection} className="text-gray-500 hover:text-gray-900 sm:ml-auto">
        Clear selection
      </button>
    </div>
  );
};
