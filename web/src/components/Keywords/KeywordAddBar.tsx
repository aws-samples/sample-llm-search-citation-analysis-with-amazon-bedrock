import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

interface KeywordAddBarProps {
  readonly isBulkMode: boolean;
  readonly setIsBulkMode: (value: boolean) => void;
  readonly newKeyword: string;
  readonly setNewKeyword: (value: string) => void;
  readonly bulkKeywords: string;
  readonly setBulkKeywords: (value: string) => void;
  readonly saving: boolean;
  readonly onAddKeyword: () => void;
  readonly onAddBulkKeywords: () => void;
  /** The "in <market>" picker for new keywords; absent while no market is configured. */
  readonly marketPicker?: ReactNode;
  /** The group selected in the filter, which new keywords join; absent under All and Ungrouped. */
  readonly targetGroupName?: string;
}

const FIELD = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-900';

/**
 * The page's primary action: type a keyword and Add, or paste a list (one
 * per line) and Add all. The market picker and the target group apply to both.
 */
export const KeywordAddBar = ({
  isBulkMode, setIsBulkMode, newKeyword, setNewKeyword, bulkKeywords, setBulkKeywords,
  saving, onAddKeyword, onAddBulkKeywords, marketPicker, targetGroupName,
}: KeywordAddBarProps) => {
  const switchMode = () => { setIsBulkMode(!isBulkMode); setNewKeyword(''); setBulkKeywords(''); };
  const readyCount = bulkKeywords.split('\n').filter((line) => line.trim().length > 0).length;
  const modeToggle = (
    <Button variant="ghost" onClick={switchMode}>{isBulkMode ? 'Add one keyword' : 'Paste a list'}</Button>
  );
  return (
    <div className="space-y-2">
      {isBulkMode ? (
        <>
          <textarea
            id="bulk-keywords"
            name="bulk-keywords"
            aria-label="Bulk keywords, one per line"
            value={bulkKeywords}
            onChange={(event) => setBulkKeywords(event.target.value)}
            placeholder="Enter multiple keywords (one per line)"
            rows={6}
            className={`${FIELD} resize-y font-mono`}
            disabled={saving}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 tabular-nums" aria-live="polite">
              {readyCount} {readyCount === 1 ? 'keyword' : 'keywords'} ready
            </span>
            <span className="flex-1" />
            {marketPicker}
            {modeToggle}
            <Button onClick={onAddBulkKeywords} disabled={saving || !bulkKeywords.trim()}>{saving ? 'Adding...' : 'Add all'}</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            id="new-keyword"
            name="new-keyword"
            aria-label="New keyword"
            value={newKeyword}
            onChange={(event) => setNewKeyword(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onAddKeyword(); }}
            placeholder="Add a keyword, e.g. best hotels in Madrid"
            className={`${FIELD} flex-1 min-w-[14rem] w-auto`}
            disabled={saving}
          />
          {marketPicker}
          <Button onClick={onAddKeyword} disabled={saving || !newKeyword.trim()}>{saving ? 'Adding...' : 'Add'}</Button>
          {modeToggle}
        </div>
      )}
      {targetGroupName !== undefined && (
        <p className="text-xs text-gray-500">New keywords join the group <q>{targetGroupName}</q>.</p>
      )}
    </div>
  );
};
