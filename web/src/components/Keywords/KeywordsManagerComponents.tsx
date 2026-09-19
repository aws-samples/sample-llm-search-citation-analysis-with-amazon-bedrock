import type { ReactNode } from 'react';
import type {
  Keyword, KeywordGroup 
} from '../../types';
import {
  KeywordGroupChips, KeywordGroupMenu 
} from './KeywordGroupAssignment';
import {
  PencilIcon, TrashIcon 
} from '../ui';

export interface KeywordInputSectionProps {
  isBulkMode: boolean;
  setIsBulkMode: (value: boolean) => void;
  newKeyword: string;
  setNewKeyword: (value: string) => void;
  bulkKeywords: string;
  setBulkKeywords: (value: string) => void;
  saving: boolean;
  onAddKeyword: () => void;
  onAddBulkKeywords: () => void;
}

export const KeywordInputSection = ({
  isBulkMode, setIsBulkMode, newKeyword, setNewKeyword,
  bulkKeywords, setBulkKeywords, saving, onAddKeyword, onAddBulkKeywords,
}: KeywordInputSectionProps) => (
  <div className="p-6 border-b border-gray-200">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-gray-900">Manage Keywords</h2>
      <ModeToggleButton
        isBulkMode={isBulkMode}
        onClick={() => { setIsBulkMode(!isBulkMode); setNewKeyword(''); setBulkKeywords(''); }}
      />
    </div>

    {isBulkMode ? (
      <BulkInput
        bulkKeywords={bulkKeywords}
        setBulkKeywords={setBulkKeywords}
        saving={saving}
        onAddBulkKeywords={onAddBulkKeywords}
      />
    ) : (
      <SingleInput
        newKeyword={newKeyword}
        setNewKeyword={setNewKeyword}
        saving={saving}
        onAddKeyword={onAddKeyword}
      />
    )}
  </div>
);

const ModeToggleButton = ({
  isBulkMode, onClick 
}: {
  isBulkMode: boolean;
  onClick: () => void 
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
      isBulkMode ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`}
  >
    {isBulkMode ? 'Single Entry' : 'Bulk Entry'}
  </button>
);

interface BulkInputProps {
  bulkKeywords: string;
  setBulkKeywords: (value: string) => void;
  saving: boolean;
  onAddBulkKeywords: () => void;
}

const BulkInput = ({
  bulkKeywords, setBulkKeywords, saving, onAddBulkKeywords 
}: BulkInputProps) => (
  <div className="space-y-3">
    <textarea
      id="bulk-keywords"
      name="bulk-keywords"
      aria-label="Bulk keywords, one per line"
      value={bulkKeywords}
      onChange={(e) => setBulkKeywords(e.target.value)}
      placeholder="Enter multiple keywords (one per line)"
      rows={6}
      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none font-mono text-sm"
      disabled={saving}
    />
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500">
        {bulkKeywords.split('\n').filter((k) => k.trim().length > 0).length} keywords ready
      </span>
      <button
        onClick={onAddBulkKeywords}
        disabled={saving || !bulkKeywords.trim()}
        className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {saving ? 'Adding...' : 'Add All'}
      </button>
    </div>
  </div>
);

interface SingleInputProps {
  newKeyword: string;
  setNewKeyword: (value: string) => void;
  saving: boolean;
  onAddKeyword: () => void;
}

const SingleInput = ({
  newKeyword, setNewKeyword, saving, onAddKeyword 
}: SingleInputProps) => (
  <div className="flex gap-3">
    <input
      type="text"
      id="new-keyword"
      name="new-keyword"
      aria-label="New keyword"
      value={newKeyword}
      onChange={(e) => setNewKeyword(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onAddKeyword()}
      placeholder="Enter new keyword..."
      className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 text-sm"
      disabled={saving}
    />
    <button
      onClick={onAddKeyword}
      disabled={saving || !newKeyword.trim()}
      className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
    >
      {saving ? 'Adding...' : 'Add'}
    </button>
  </div>
);

export interface KeywordListProps {
  keywords: Keyword[];
  editingId: string | null;
  editText: string;
  setEditText: (value: string) => void;
  onStartEdit: (keyword: Keyword) => void;
  onUpdateKeyword: (id: string) => void;
  onCancelEdit: () => void;
  onDeleteKeyword: (id: string) => void;
  /** Group features (optional so the list also works without groups loaded). */
  groups?: KeywordGroup[];
  bulkSelectedIds?: ReadonlySet<string>;
  onToggleBulkSelect?: (id: string) => void;
  groupMenuKeywordId?: string | null;
  onToggleGroupMenu?: (id: string) => void;
  onToggleMembership?: (keyword: Keyword, group: KeywordGroup, member: boolean) => void;
  membershipBusy?: boolean;
  emptyMessage?: string;
}

export const KeywordList = ({
  keywords, editingId, editText, setEditText,
  onStartEdit, onUpdateKeyword, onCancelEdit, onDeleteKeyword,
  groups = [], bulkSelectedIds, onToggleBulkSelect, groupMenuKeywordId = null,
  onToggleGroupMenu, onToggleMembership, membershipBusy = false, emptyMessage,
}: KeywordListProps) => {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return (
    <div className="p-6">
      {keywords.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="space-y-2">
          {keywords.map((keyword) => (
            <KeywordItem
              key={keyword.id}
              keyword={keyword}
              isEditing={editingId === keyword.id}
              editText={editText}
              setEditText={setEditText}
              onStartEdit={() => onStartEdit(keyword)}
              onUpdateKeyword={() => onUpdateKeyword(keyword.id)}
              onCancelEdit={onCancelEdit}
              onDeleteKeyword={() => onDeleteKeyword(keyword.id)}
              groupsById={groupsById}
              bulkSelected={bulkSelectedIds?.has(keyword.id) ?? false}
              onToggleBulkSelect={onToggleBulkSelect ? () => onToggleBulkSelect(keyword.id) : undefined}
              groupMenu={groupMenuKeywordId === keyword.id && onToggleMembership ? (
                <KeywordGroupMenu
                  keyword={keyword}
                  groups={groups}
                  busy={membershipBusy}
                  onToggle={(group, member) => onToggleMembership(keyword, group, member)}
                  onClose={() => onToggleGroupMenu?.(keyword.id)}
                />
              ) : null}
              onOpenGroups={onToggleGroupMenu ? () => onToggleGroupMenu(keyword.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const EmptyState = ({ message }: { message?: string }) => (
  <div className="text-center py-12 text-gray-400">
    <TagIcon />
    <p className="text-sm">{message ?? 'No keywords yet. Add your first keyword above.'}</p>
  </div>
);

const TagIcon = () => (
  <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
  </svg>
);

interface KeywordItemProps {
  keyword: Keyword;
  isEditing: boolean;
  editText: string;
  setEditText: (value: string) => void;
  onStartEdit: () => void;
  onUpdateKeyword: () => void;
  onCancelEdit: () => void;
  onDeleteKeyword: () => void;
  groupsById: ReadonlyMap<string, KeywordGroup>;
  bulkSelected: boolean;
  onToggleBulkSelect?: () => void;
  groupMenu: ReactNode;
  onOpenGroups?: () => void;
}

const KeywordItem = ({
  keyword, isEditing, editText, setEditText,
  onStartEdit, onUpdateKeyword, onCancelEdit, onDeleteKeyword,
  groupsById, bulkSelected, onToggleBulkSelect, groupMenu, onOpenGroups,
}: KeywordItemProps) => (
  <div className={`flex flex-wrap items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors ${bulkSelected ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}>
    {onToggleBulkSelect && !isEditing && (
      <input
        type="checkbox"
        aria-label={`Select ${keyword.keyword}`}
        checked={bulkSelected}
        onChange={onToggleBulkSelect}
        className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
      />
    )}
    {isEditing ? (
      <EditingView
        editText={editText}
        setEditText={setEditText}
        onUpdateKeyword={onUpdateKeyword}
        onCancelEdit={onCancelEdit}
      />
    ) : (
      <DisplayView
        keyword={keyword}
        groupsById={groupsById}
        onStartEdit={onStartEdit}
        onDeleteKeyword={onDeleteKeyword}
        onOpenGroups={onOpenGroups}
      />
    )}
    {groupMenu}
  </div>
);

interface EditingViewProps {
  editText: string;
  setEditText: (value: string) => void;
  onUpdateKeyword: () => void;
  onCancelEdit: () => void;
}

const EditingView = ({
  editText, setEditText, onUpdateKeyword, onCancelEdit 
}: EditingViewProps) => (
  <>
    <input
      type="text"
      value={editText}
      onChange={(e) => setEditText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onUpdateKeyword()}
      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 text-sm"
      autoFocus
    />
    <button onClick={onUpdateKeyword} className="px-3 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">Save</button>
    <button onClick={onCancelEdit} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
  </>
);

interface DisplayViewProps {
  keyword: Keyword;
  groupsById: ReadonlyMap<string, KeywordGroup>;
  onStartEdit: () => void;
  onDeleteKeyword: () => void;
  onOpenGroups?: () => void;
}

const DisplayView = ({
  keyword, groupsById, onStartEdit, onDeleteKeyword, onOpenGroups 
}: DisplayViewProps) => (
  <>
    <span className="flex-1 flex flex-wrap items-center gap-2 text-sm text-gray-900">
      <span>{keyword.keyword}</span>
      <KeywordGroupChips keyword={keyword} groupsById={groupsById} />
    </span>
    <span className="text-xs text-gray-400">{new Date(keyword.created_at).toLocaleDateString()}</span>
    {onOpenGroups && (
      <button
        onClick={onOpenGroups}
        aria-label={`Edit groups for ${keyword.keyword}`}
        className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded border border-gray-200"
      >
        Groups
      </button>
    )}
    <button onClick={onStartEdit} aria-label={`Edit ${keyword.keyword}`} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
      <PencilIcon className="w-4 h-4" />
    </button>
    <button onClick={onDeleteKeyword} aria-label={`Delete ${keyword.keyword}`} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
      <TrashIcon className="w-4 h-4" />
    </button>
  </>
);
