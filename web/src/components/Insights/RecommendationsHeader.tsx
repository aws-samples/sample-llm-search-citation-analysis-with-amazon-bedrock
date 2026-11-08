import type { ReactNode } from 'react';
import { requestParams } from '../../api/exports';
import type { ListRequest } from '../../api/scopedListPages';
import { RefreshIcon } from '../ui';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import { StrokeIcon } from '../ui/StrokeIcon';
import { BOLT_PATHS } from '../ui/iconPaths';

interface HeaderProps {
  useLlm: boolean;
  setUseLlm: (value: boolean) => void;
  onRefresh: () => void;
  scopeSelector: ReactNode;
  exportButton: ReactNode;
}

/**
 * The Action Center's export params: its scope and market. The rule recommendations are
 * exported with their saved status; an AI-enhanced answer is never generated again for an export.
 */
export function recommendationExportParams(request: ListRequest | null): Record<string, string> | null {
  const params = requestParams(request);
  if (params === null) return null;
  return Object.fromEntries(Object.entries(params).filter(([name]) => name !== 'use_llm'));
}

/** The Action Center's header card: scope, AI Enhanced, Refresh and Export all. */
export const RecommendationsHeader = ({
  useLlm, setUseLlm, onRefresh, scopeSelector, exportButton
}: HeaderProps) => (
  <PageHeaderCard
    title="Action Center"
    description={(
      <>
        Get prioritized, actionable recommendations to improve your AI search visibility. 
        Each recommendation is based on analysis of your visibility gaps, competitor performance, 
        and citation patterns. Enable "AI Enhanced" for deeper, LLM-powered insights.
      </>
    )}
    note={(
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-xs sm:text-sm">
          <StrokeIcon className="w-3.5 h-3.5" paths={BOLT_PATHS} strokeWidth={2} />
          <span className="hidden sm:inline">Start with high-priority items for biggest impact</span>
          <span className="sm:hidden">Start with high-priority items</span>
        </span>
      </div>
    )}
  >
    {scopeSelector}
    <div className="flex flex-col sm:flex-row gap-3">
      <label className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
        <input
          type="checkbox"
          checked={useLlm}
          onChange={(e) => setUseLlm(e.target.checked)}
          className="rounded-sm border-gray-300 text-gray-900 focus:ring-gray-900"
        />
        <span className="text-gray-700 font-medium">AI Enhanced</span>
      </label>
      <button
        onClick={onRefresh}
        className="px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <RefreshIcon className="w-4 h-4" />
        Refresh
      </button>
      {exportButton}
    </div>
  </PageHeaderCard>
);
