import type { Keyword } from '../../types';

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
}

export const KeywordList = ({
  keywords, editingId, editText, setEditText,
  onStartEdit, onUpdateKeyword, onCancelEdit, onDeleteKeyword,
}: KeywordListProps) => (
  <div className="p-6">
    {keywords.length === 0 ? (
      <EmptyState />
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
          />
        ))}
      </div>
    )}
  </div>
);

const EmptyState = () => (
  <div className="text-center py-12 text-gray-400">
    <TagIcon />
    <p className="text-sm">No keywords yet. Add your first keyword above.</p>
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
}

const KeywordItem = ({
  keyword, isEditing, editText, setEditText,
  onStartEdit, onUpdateKeyword, onCancelEdit, onDeleteKeyword,
}: KeywordItemProps) => (
  <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
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
        onStartEdit={onStartEdit}
        onDeleteKeyword={onDeleteKeyword}
      />
    )}
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
  onStartEdit: () => void;
  onDeleteKeyword: () => void;
}

const DisplayView = ({
  keyword, onStartEdit, onDeleteKeyword 
}: DisplayViewProps) => (
  <>
    <span className="flex-1 text-sm text-gray-900">{keyword.keyword}</span>
    <span className="text-xs text-gray-400">{new Date(keyword.created_at).toLocaleDateString()}</span>
    <button onClick={onStartEdit} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
      <EditIcon />
    </button>
    <button onClick={onDeleteKeyword} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
      <TrashIcon />
    </button>
  </>
);

const EditIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
