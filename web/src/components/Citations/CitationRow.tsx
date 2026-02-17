import React from 'react';
import type { TopUrl } from '../../types';
import { Spinner } from '../ui/Spinner';

interface UrlBreakdown {
  keyword: string;
  provider: string;
  timestamp: string;
}

interface CitationRowProps {
  citation: TopUrl;
  idx: number;
  globalRank: number;
  isExpanded: boolean;
  breakdown: UrlBreakdown[];
  isLoading: boolean;
  onToggleRow: (idx: number, url: string) => void;
  onViewDetails: (url: string, e: React.MouseEvent) => void;
  onKeywordClick: (keyword: string) => void;
  getDomain: (url: string) => string;
}

export const CitationRow = ({
  citation,
  idx,
  globalRank,
  isExpanded,
  breakdown,
  isLoading,
  onToggleRow,
  onViewDetails,
  onKeywordClick,
  getDomain,
}: CitationRowProps) => {
  // Group breakdown by keyword
  const keywordGroups: Record<string, UrlBreakdown[]> = {};
  breakdown.forEach(item => {
    if (!keywordGroups[item.keyword]) {
      keywordGroups[item.keyword] = [];
    }
    keywordGroups[item.keyword].push(item);
  });

  const keywordCount = Object.keys(keywordGroups).length;
  const keywordText = keywordCount === 1 ? '' : 's';

  return (
    <React.Fragment key={citation.url}>
      <tr 
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => onToggleRow(idx, citation.url)}
      >
        <td className="px-6 py-4 text-sm text-gray-400">
          {globalRank}
        </td>
        <td className="px-6 py-4 text-sm">
          <div className="flex items-center gap-2">
            <a 
              href={citation.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-gray-900 hover:underline flex-1"
              title={citation.url}
              onClick={(e) => e.stopPropagation()}
            >
              {citation.url.length > 60 ? citation.url.substring(0, 60) + '...' : citation.url}
            </a>
            <button
              onClick={(e) => onViewDetails(citation.url, e)}
              className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
              title="View crawled content and screenshot"
            >
              View
            </button>
          </div>
        </td>
        <td className="px-6 py-4 text-sm text-gray-500">
          {getDomain(citation.url)}
        </td>
        <td className="px-6 py-4">
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
            {citation.keyword_count ?? 0}
          </span>
        </td>
        <td className="px-6 py-4">
          <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium inline-flex items-center gap-1">
            {citation.citation_count}
            <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr key={`${citation.url}-exp`}>
          <td colSpan={5} className="px-6 py-4 bg-gray-50">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 gap-2">
                <Spinner size="sm" className="text-gray-500" />
                <span className="text-sm text-gray-500">Loading...</span>
              </div>
            ) : (
              <>
                {Object.keys(keywordGroups).length > 0 ? (
                  <div className="text-sm">
                    <div className="font-medium text-gray-700 mb-3">
                      Ranking for {keywordCount} keyword{keywordText}
                    </div>
                    <div className="grid gap-2">
                      {Object.entries(keywordGroups).map(([keyword, items]) => {
                        const providerCount = [...new Set(items.map(item => item.provider))].length;
                        const providerText = providerCount === 1 ? '' : 's';
                        
                        return (
                          <div 
                            key={keyword} 
                            className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              onKeywordClick(keyword);
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-gray-900 hover:text-gray-600">{keyword}</span>
                              <div className="flex gap-1">
                                {[...new Set(items.map(item => item.provider))].map((provider) => (
                                  <span key={provider} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                    {provider}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">
                                {providerCount} provider{providerText}
                              </span>
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-sm text-gray-500">No breakdown data</div>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  );
};