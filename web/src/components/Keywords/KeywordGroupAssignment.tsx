import { useState } from 'react';
import type {
  Keyword, KeywordGroup
} from '../../types';
import { Button } from '../ui/Button';

interface KeywordGroupSummaryProps {
  readonly keyword: Keyword;
  readonly groupsById: ReadonlyMap<string, KeywordGroup>;
}

/** A keyword's groups in one table cell: the first name and "+N" for the rest; every name in the tooltip. */
export const KeywordGroupSummary = ({
  keyword, groupsById
}: KeywordGroupSummaryProps) => {
  const names = (keyword.group_ids ?? [])
    .map((id) => groupsById.get(id)?.name)
    .filter((name): name is string => name !== undefined)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) return <span className="text-gray-500" title="In no group">—</span>;
  const [first, ...rest] = names;
  return (
    <span className="flex items-center gap-1 min-w-0" title={names.join(', ')}>
      <span className="truncate px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{first}</span>
      {rest.length > 0 && <span className="shrink-0 text-xs text-gray-500">+{rest.length}</span>}
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

/** Checkbox list to add/remove one keyword from each group, opened under its row. */
export const KeywordGroupMenu = ({
  keyword, groups, busy, onToggle, onClose
}: KeywordGroupMenuProps) => {
  const memberships = new Set(keyword.group_ids ?? []);
  return (
    <fieldset className="p-3 border border-gray-200 rounded-lg bg-white">
      <legend className="px-1 text-xs font-medium text-gray-600">{`Groups for ${keyword.keyword}`}</legend>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-500">No groups yet. Use New group to create one.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1">
          {groups.map((group) => {
            const member = memberships.has(group.id);
            return (
              <label key={group.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-gray-50 cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={member}
                  disabled={busy}
                  onChange={() => onToggle(group, member)}
                  className="w-4 h-4 text-gray-900 rounded-sm border-gray-300 focus:ring-gray-900"
                />
                <span className="text-sm text-gray-700 truncate">{group.name}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-end mt-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
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

/**
 * Bulk membership and status actions for the ticked keywords. It takes the
 * table toolbar's place while rows are ticked and sticks under the app header.
 */
export const BulkGroupBar = ({
  selectedCount, groups, busy, onAddToGroup, onRemoveFromGroup, onClearSelection,
  pausedSelectedCount = 0, onActivateSelected, onPauseSelected,
}: BulkGroupBarProps) => {
  const [groupId, setGroupId] = useState('');
  const chosen = groups.find((group) => group.id === groupId);
  if (selectedCount === 0) return null;
  return (
    <section aria-label="Selected keywords"
      className="sticky top-16 z-10 flex flex-wrap items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-gray-100 shadow-xs text-sm">
      <span className="font-medium text-gray-900 tabular-nums">{selectedCount} selected</span>
      <select
        aria-label="Group for selected keywords"
        value={groupId}
        onChange={(event) => setGroupId(event.target.value)}
        disabled={busy || groups.length === 0}
        className="py-1.5 pl-3 pr-8 max-w-[11rem] border border-gray-200 rounded-lg bg-white text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900"
      >
        <option value="">Choose a group...</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>{group.name}</option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !chosen} onClick={() => { if (chosen) onAddToGroup(chosen); }}>Add to group</Button>
      <Button variant="secondary" size="sm" disabled={busy || !chosen} onClick={() => { if (chosen) onRemoveFromGroup(chosen); }}>
        Remove from group
      </Button>
      <BulkStatusButtons busy={busy} pausedSelectedCount={pausedSelectedCount}
        onActivateSelected={onActivateSelected} onPauseSelected={onPauseSelected} />
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClearSelection} aria-label="Clear selection">Clear</Button>
    </section>
  );
};

interface BulkStatusButtonsProps {
  readonly busy: boolean;
  readonly pausedSelectedCount: number;
  readonly onActivateSelected?: () => void;
  readonly onPauseSelected?: () => void;
}

/** Activate / Pause for the ticked keywords, after a divider. */
const BulkStatusButtons = ({
  busy, pausedSelectedCount, onActivateSelected, onPauseSelected
}: BulkStatusButtonsProps) => {
  if (!onActivateSelected && !onPauseSelected) return null;
  return (
    <>
      <span aria-hidden="true" className="h-5 w-px bg-gray-300 dark:bg-gray-600" />
      {onActivateSelected && (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || pausedSelectedCount === 0}
          onClick={onActivateSelected}
          // The count is in the label because activating is the expensive
          // direction: each active keyword is queried against every provider on
          // the next run, so "Activate 40" should not be a silent click.
          title={pausedSelectedCount === 0 ? 'Every selected keyword is already active' : undefined}
        >
          Activate{pausedSelectedCount > 0 ? ` ${pausedSelectedCount}` : ''}
        </Button>
      )}
      {onPauseSelected && <Button variant="secondary" size="sm" disabled={busy} onClick={onPauseSelected}>Pause</Button>}
    </>
  );
};
