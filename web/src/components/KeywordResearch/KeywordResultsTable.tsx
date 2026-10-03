import { useState } from 'react';
import type { ResearchKeyword } from '../../types';
import {
  keywordSelectionKey, uniqueResearchKeywords
} from '../../hooks/keywordIdentity';
import { useClipboardCopy } from '../../hooks/useClipboardCopy';
import { exportResearchKeywords } from './researchExport';
import { useExportAction } from '../ui/useExportAction';
import {
  CopyKeywordCell, KeywordSignalCells
} from './KeywordSignalCells';
import type { KeywordSelectionProps } from './researchRunView';

interface KeywordResultsTableProps extends KeywordSelectionProps {
  keywords: ResearchKeyword[];
  title: string;
  subtitle?: string;
  compact?: boolean;
}

interface KeywordResultRowProps extends KeywordSelectionProps {
  keyword: ResearchKeyword;
  onCopy: (text: string) => void;
}

const KeywordResultRow = ({
  keyword, selectable, selected, onToggle, onCopy
}: KeywordResultRowProps) => {
  const selectionKey = keywordSelectionKey(keyword.keyword);
  return (
    <tr className="hover:bg-gray-50">
      {selectable && (
        <td className="px-6 py-4">
          <input
            type="checkbox"
            checked={selected?.has(selectionKey) ?? false}
            onChange={() => onToggle?.(keyword.keyword)}
            aria-label={`Select ${keyword.keyword}`}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
        </td>
      )}
      <td className="px-6 py-4 text-sm text-gray-900">{keyword.keyword}</td>
      <KeywordSignalCells keyword={keyword} />
      <CopyKeywordCell keyword={keyword.keyword} onCopy={onCopy} />
    </tr>
  );
};

export const KeywordResultsTable = ({
  keywords, title, subtitle, compact = false, selectable = false, selected, onToggle
}: KeywordResultsTableProps) => {
  const [sortBy, setSortBy] = useState<'relevance' | 'competition'>('relevance');
  const [filterIntent, setFilterIntent] = useState<string>('all');
  const { copy } = useClipboardCopy();

  const uniqueKeywords = uniqueResearchKeywords(keywords);
  const filteredKeywords = uniqueKeywords.filter((keyword) =>
    filterIntent === 'all' || keyword.intent?.toLowerCase() === filterIntent
  );

  const sortedKeywords = [...filteredKeywords].sort((left, right) => {
    if (sortBy === 'relevance') return (right.relevance ?? 0) - (left.relevance ?? 0);
    const competitionOrder: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3
    };
    const leftCompetition = left.competition?.toLowerCase() ?? '';
    const rightCompetition = right.competition?.toLowerCase() ?? '';
    return (competitionOrder[leftCompetition] ?? 2) - (competitionOrder[rightCompetition] ?? 2);
  });
  const {
    exporting, handleExport 
  } = useExportAction(
    () => exportResearchKeywords(sortedKeywords, title),
    '[research] Excel export failed:',
  );

  if (uniqueKeywords.length === 0) return null;

  return (
    <div className={compact ? '' : 'bg-white rounded-lg border border-gray-200'}>
      <div className={`${compact ? 'py-3' : 'px-4 sm:px-6 py-4 border-b border-gray-200'} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={filterIntent}
            onChange={(event) => setFilterIntent(event.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none flex-1 sm:flex-none"
          >
            <option value="all">All Intents</option>
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
            <option value="navigational">Navigational</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'relevance' || value === 'competition') {
                setSortBy(value);
              }
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none flex-1 sm:flex-none"
          >
            <option value="relevance">Sort by Relevance</option>
            <option value="competition">Sort by Competition</option>
          </select>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {selectable && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Select</th>
              )}
              {['Keyword', 'Intent', 'Competition', 'Relevance'].map((column) => (
                <th key={column} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{column}</th>
              ))}
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedKeywords.map((keyword) => (
              <KeywordResultRow
                key={keywordSelectionKey(keyword.keyword)}
                keyword={keyword}
                selectable={selectable}
                selected={selected}
                onToggle={onToggle}
                onCopy={(text) => void copy(text)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
