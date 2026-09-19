import { useState } from 'react';
import type { KeywordGroup } from '../../types';
import type { MutationOutcome } from '../../hooks/useKeywordGroups';

/** Which keywords the list below shows: everything, the ungrouped ones, or one group. */
export type GroupFilter = 'all' | 'ungrouped' | { groupId: string };

export function isGroupFilterFor(filter: GroupFilter, groupId: string): boolean {
  return typeof filter === 'object' && filter.groupId === groupId;
}

interface KeywordGroupsPanelProps {
  readonly groups: KeywordGroup[];
  readonly loading: boolean;
  readonly totalKeywords: number;
  readonly ungroupedCount: number;
  readonly filter: GroupFilter;
  readonly onFilterChange: (filter: GroupFilter) => void;
  readonly onCreate: (name: string) => Promise<MutationOutcome>;
  readonly onRename: (id: string, name: string) => Promise<MutationOutcome>;
  readonly onDelete: (group: KeywordGroup) => void;
  readonly onNotify: (title: string, message: string, variant: 'success' | 'error') => void;
}

/**
 * Keyword groups ("folders", e.g. one per hotel): create, rename, delete, and
 * pick which group the keyword list is filtered to. Deleting a group only
 * detaches its keywords — the keywords themselves are kept.
 */
export const KeywordGroupsPanel = ({
  groups, loading, totalKeywords, ungroupedCount, filter,
  onFilterChange, onCreate, onRename, onDelete, onNotify,
}: KeywordGroupsPanelProps) => {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const outcome = await onCreate(name);
      if (outcome.success) {
        setNewName('');
      } else {
        onNotify('Could not create group', outcome.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (id: string) => {
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const outcome = await onRename(id, name);
      if (outcome.success) {
        setEditingId(null);
      } else {
        onNotify('Could not rename group', outcome.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const filterButtonClass = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-lg border transition-colors ${
      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
    }`;

  return (
    <div className="p-6 border-b border-gray-200 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Keyword Groups</h2>
          <p className="text-sm text-gray-500">Organise keywords into reusable groups, for example by brand, market, campaign, or location. A keyword can belong to several groups.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          aria-label="New group name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submitCreate(); }}
          placeholder="New group name (e.g. Spring campaign)"
          disabled={busy}
          className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 text-sm"
        />
        <button
          type="button"
          onClick={() => { void submitCreate(); }}
          disabled={busy || !newName.trim()}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Create group
        </button>
      </div>

      <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0">
        <legend className="sr-only">Filter keywords by group</legend>
        <button type="button" className={filterButtonClass(filter === 'all')} onClick={() => onFilterChange('all')}>
          All <span className="text-xs opacity-70">({totalKeywords})</span>
        </button>
        <button type="button" className={filterButtonClass(filter === 'ungrouped')} onClick={() => onFilterChange('ungrouped')}>
          Ungrouped <span className="text-xs opacity-70">({ungroupedCount})</span>
        </button>
        {loading && groups.length === 0 && <span className="text-sm text-gray-400">Loading groups...</span>}
        {groups.map((group) => (
          <div key={group.id} className="flex items-center gap-1">
            {editingId === group.id ? (
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label={`Rename group ${group.name}`}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitRename(group.id);
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <button type="button" onClick={() => { void submitRename(group.id); }} className="px-2 py-1 text-sm bg-gray-900 text-white rounded-lg">Save</button>
                <button type="button" onClick={() => setEditingId(null)} className="px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded-lg">Cancel</button>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className={filterButtonClass(isGroupFilterFor(filter, group.id))}
                  onClick={() => onFilterChange({ groupId: group.id })}
                  title={group.description || group.name}
                >
                  {group.name} <span className="text-xs opacity-70">({group.keyword_count})</span>
                </button>
                <button
                  type="button"
                  aria-label={`Rename group ${group.name}`}
                  onClick={() => { setEditingId(group.id); setEditName(group.name); }}
                  className="p-1 text-gray-400 hover:text-gray-700 rounded"
                >
                  <PencilGlyph />
                </button>
                <button
                  type="button"
                  aria-label={`Delete group ${group.name}`}
                  onClick={() => onDelete(group)}
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                >
                  <TrashGlyph />
                </button>
              </>
            )}
          </div>
        ))}
      </fieldset>
    </div>
  );
};

const PencilGlyph = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashGlyph = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
