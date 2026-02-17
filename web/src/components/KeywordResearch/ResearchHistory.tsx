import {
  useEffect, useState 
} from 'react';
import type {
  KeywordResearchItem, ResearchKeyword 
} from '../../types';
import { KeywordResultsTable } from './KeywordResultsTable';
import { formatDate } from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';

interface ResearchHistoryProps {
  history: KeywordResearchItem[];
  loading: boolean;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => void;
}

const getKeywordsForItem = (item: KeywordResearchItem): ResearchKeyword[] => {
  if (item.type === 'expansion' && item.keywords) {
    return item.keywords;
  }
  if (item.type === 'competitor' && item.analysis) {
    return [
      ...(item.analysis.primary_keywords ?? []),
      ...(item.analysis.secondary_keywords ?? []),
      ...(item.analysis.longtail_keywords ?? []),
      ...(item.analysis.content_gaps ?? []),
    ];
  }
  return [];
};

export const ResearchHistory = ({
  history,
  loading,
  onDelete,
  onRefresh,
}: ResearchHistoryProps) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    onRefresh();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      <Header loading={loading} onRefresh={onRefresh} />

      {loading && history.length === 0 && <LoadingState />}

      {!loading && history.length === 0 && <EmptyState />}

      {history.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {history.map((item) => (
            <HistoryItem
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              onToggle={() => toggleExpand(item.id)}
              onDelete={() => onDelete(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface HeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

const Header = ({
  loading, onRefresh 
}: HeaderProps) => (
  <div className="flex items-center justify-between">
    <p className="text-sm text-gray-600">
      View your past keyword research and competitor analyses.
    </p>
    <button
      onClick={onRefresh}
      disabled={loading}
      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
    >
      <svg
        className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      Refresh
    </button>
  </div>
);

const LoadingState = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
    <Spinner size="lg" className="mx-auto text-gray-400" />
    <p className="mt-4 text-sm text-gray-500">Loading history...</p>
  </div>
);

const EmptyState = () => (
  <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
    <svg
      className="w-12 h-12 mx-auto text-gray-300"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    <p className="mt-4 text-sm text-gray-500">No research history yet</p>
    <p className="text-xs text-gray-400 mt-1">
      Start by expanding a keyword or analyzing a competitor
    </p>
  </div>
);

interface HistoryItemProps {
  item: KeywordResearchItem;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

const HistoryItem = ({
  item, isExpanded, onToggle, onDelete 
}: HistoryItemProps) => {
  const keywords = getKeywordsForItem(item);
  const hasKeywords = keywords.length > 0;
  const itemTitle = item.type === 'expansion' ? item.seed_keyword : (item.domain ?? item.url);

  return (
    <div>
      <div
        className={`p-3 sm:p-4 transition-colors ${hasKeywords ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => hasKeywords && onToggle()}
      >
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1 flex items-start gap-2 sm:gap-3">
            {hasKeywords && <ExpandIcon isExpanded={isExpanded} />}

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={item.type} />
                <span className="text-sm font-medium text-gray-900 truncate">{itemTitle}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 text-xs text-gray-500">
                <span>{formatDate(item.created_at)}</span>
                <span className="hidden sm:inline">•</span>
                <span>{item.keyword_count ?? 0} keywords</span>
                {item.industry && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    <span className="capitalize">{item.industry}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <DeleteButton onClick={onDelete} />
        </div>
      </div>

      {isExpanded && hasKeywords && (
        <div className="border-t border-gray-100 bg-gray-50 p-4">
          <KeywordResultsTable
            keywords={keywords}
            title={`${keywords.length} keywords for "${itemTitle}"`}
            subtitle={`Industry: ${item.industry ?? 'general'}`}
            compact
          />
        </div>
      )}
    </div>
  );
};

const ExpandIcon = ({ isExpanded }: { isExpanded: boolean }) => (
  <button className="mt-0.5 text-gray-400 shrink-0">
    <svg
      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  </button>
);

const TypeBadge = ({ type }: { type: string }) => (
  <span
    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
      type === 'expansion' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
    }`}
  >
    {type === 'expansion' ? 'Expansion' : 'Competitor'}
  </span>
);

interface DeleteButtonProps {onClick: () => void;}

const DeleteButton = ({ onClick }: DeleteButtonProps) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors self-end sm:self-start"
    title="Delete"
  >
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  </button>
);
