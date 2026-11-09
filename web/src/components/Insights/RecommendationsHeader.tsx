import type { ReactNode } from 'react';
import { requestParams } from '../../api/exports';
import type { ListRequest } from '../../api/scopedListPages';
import { RefreshIcon } from '../ui';
import { PageHeaderCard } from '../ui/PageHeaderCard';

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
        What to do next to raise your AI search visibility, highest priority first. Rules build each item from your
        visibility gaps, competitor mentions and citations. Turn on AI Enhanced to add suggestions written by a
        Bedrock model.
      </>
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
        type="button"
        onClick={onRefresh}
        className="px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 text-sm font-medium transition-colors flex items-center justify-center gap-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-500"
      >
        <RefreshIcon className="w-4 h-4" />
        Refresh
      </button>
      {exportButton}
    </div>
  </PageHeaderCard>
);
