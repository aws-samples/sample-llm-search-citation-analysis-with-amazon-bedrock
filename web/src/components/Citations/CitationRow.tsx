import React from 'react';
import type { TopUrl } from '../../types';
import { getDomain } from '../../formatting/urlFormatter';
import { safeHref } from '../../infrastructure';
import { Spinner } from '../ui/Spinner';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  CHEVRON_DOWN_PATHS, CHEVRON_RIGHT_PATHS
} from '../ui/iconPaths';
import {
  isVideoCitation, type UrlBreakdown
} from '../../exporters/citationParser';
import { VideoBadge } from './VideoBadge';
import { providerName } from '../../constants/providers';

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
        <td className="px-6 py-4 text-sm text-gray-500">
          {globalRank}
        </td>
        <td className="px-6 py-4 text-sm">
          <div className="flex items-center gap-2">
            <a 
              href={safeHref(citation.url)} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-gray-900 hover:underline flex-1"
              title={citation.url}
              onClick={(e) => e.stopPropagation()}
            >
              {citation.url.length > 60 ? citation.url.substring(0, 60) + '...' : citation.url}
            </a>
            {isVideoCitation(citation) && <VideoBadge />}
            <button
              type="button"
              onClick={(e) => onViewDetails(citation.url, e)}
              className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
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
          {/* The keyboard and screen-reader toggle of the row's breakdown; a click anywhere on the row toggles it too. */}
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${citation.citation_count} citations: show keywords and AI engines`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleRow(idx, citation.url);
            }}
            className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium inline-flex items-center gap-1 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            {citation.citation_count}
            <StrokeIcon className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} paths={CHEVRON_DOWN_PATHS} strokeWidth={2} aria-hidden="true" />
          </button>
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
                      Cited for {keywordCount} keyword{keywordText}
                    </div>
                    <div className="grid gap-2">
                      {Object.entries(keywordGroups).map(([keyword, items]) => {
                        const providerCount = [...new Set(items.map(item => item.provider))].length;
                        const providerText = providerCount === 1 ? '' : 's';
                        
                        return (
                          <button
                            type="button"
                            key={keyword}
                            className="w-full text-left flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              onKeywordClick(keyword);
                            }}
                          >
                            <span className="flex flex-wrap items-center gap-3 min-w-0">
                              <span className="font-medium text-gray-900 break-words">{keyword}</span>
                              <span className="flex flex-wrap gap-1">
                                {[...new Set(items.map(item => item.provider))].map((provider) => (
                                  <span key={provider} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs capitalize">
                                    {providerName(provider)}
                                  </span>
                                ))}
                              </span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">
                                {providerCount} provider{providerText}
                              </span>
                              <StrokeIcon className="w-4 h-4 text-gray-500" paths={CHEVRON_RIGHT_PATHS} aria-hidden="true" />
                            </span>
                          </button>
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