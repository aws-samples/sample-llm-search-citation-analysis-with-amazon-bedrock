/**
 * Keyword Explorer: DataForSEO keyword ideas for one seed in the header market.
 * A tab of Keyword Research.
 *
 * Paid queries run only on submit (Search, a keyword click, "Load top 50"):
 * nothing is fetched on mount, focus or retry, so no call is billed that the user did not ask for.
 */
import {
  useCallback, useEffect, useState
} from 'react';
import { marketRequestField } from '../../../api/marketRequestField';
import { isSeoApiConfigured } from '../../../api/seo';
import { useKeywordExplorer } from '../../../hooks/useKeywordExplorer';
import { useSerpSnapshot } from '../../../hooks/useSerpSnapshot';
import type { Keyword } from '../../../types';
import type { KeywordResearchRequest } from '../../../types/api/seo';
import { useMarketSelection } from '../../Markets/marketSelectionContext';
import { CenteredEmpty } from '../../ui/CenteredState';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { SearchIcon } from '../../ui/Icons';
import {
  SkeletonRegion, SkeletonTable
} from '../../ui/Skeleton';
import { KeywordExplorerForm } from './KeywordExplorerForm';
import { KeywordExplorerResults } from './KeywordExplorerResults';

export const NOT_SET_UP_TITLE = 'SEO data is not set up';

interface KeywordExplorerProps {readonly onKeywordsAdded?: (created: Keyword[]) => void;}

/** Shown when the dashboard was built without the SEO stack's API URL. */
export function SeoNotSetUp() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-2">
      <h3 className="text-base font-semibold text-gray-900">{NOT_SET_UP_TITLE}</h3>
      <p className="text-sm text-gray-600">
        The Keyword Explorer reads search volume, difficulty and Google results from DataForSEO through the SEO stack.
      </p>
      <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
        <li>Deployment: deploy the SEO stack (<code>CitationAnalysisSeoStack</code>) and rebuild the dashboard.</li>
        <li>Admin: add the DataForSEO login in Settings › AI Providers.</li>
      </ul>
    </div>
  );
}

function ResearchSkeleton() {
  return (
    <SkeletonRegion label="Loading keyword ideas" className="bg-white rounded-lg border border-gray-200">
      <div className="h-11 bg-gray-50" />
      <SkeletonTable rows={8} columns={8} rowClassName="h-12" />
    </SkeletonRegion>
  );
}

function ConfiguredExplorer({ onKeywordsAdded }: KeywordExplorerProps) {
  const { selectedMarketId } = useMarketSelection();
  const research = useKeywordExplorer();
  const serp = useSerpSnapshot();
  const [serpKeyword, setSerpKeyword] = useState<string | null>(null);
  const [researched, setResearched] = useState<KeywordResearchRequest | null>(null);
  const {
    reset: resetResearch, run: runResearch 
  } = research;
  const {
    reset: resetSerp, run: runSerp 
  } = serp;

  // Results of another market must not be tracked into the new one.
  useEffect(() => {
    resetResearch();
    resetSerp();
    setSerpKeyword(null);
  }, [selectedMarketId, resetResearch, resetSerp]);

  const search = (request: Omit<KeywordResearchRequest, 'market_id'>) => {
    resetSerp();
    setSerpKeyword(null);
    const sent: KeywordResearchRequest = {
      ...request,
      ...marketRequestField(selectedMarketId),
    };
    setResearched(sent);
    void runResearch(sent);
  };

  const openSerp = useCallback((keyword: string, depth: 20 | 50 = 20) => {
    setSerpKeyword(keyword);
    void runSerp({
      keyword,
      depth,
      ...marketRequestField(selectedMarketId),
    });
  }, [runSerp, selectedMarketId]);

  const { state } = research;
  return (
    <div className="space-y-4">
      <KeywordExplorerForm onSearch={search} searching={state.status === 'loading'} />
      {state.status === 'idle' && (
        <CenteredEmpty
          icon={<SearchIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />}
          title="Enter a keyword to get started"
          hint="See search volume, trend, difficulty, CPC and related keyword ideas for the market chosen in the header."
        />
      )}
      {state.status === 'loading' && <ResearchSkeleton />}
      {state.status === 'error' && <ErrorAlert message={state.message} />}
      {state.status === 'success' && researched !== null && (
        <KeywordExplorerResults
          request={researched}
          response={state.response}
          serpKeyword={serpKeyword}
          serpState={serp.state}
          onOpenSerp={openSerp}
          onKeywordsAdded={onKeywordsAdded}
        />
      )}
    </div>
  );
}

export function KeywordExplorer({ onKeywordsAdded }: KeywordExplorerProps) {
  if (!isSeoApiConfigured()) return <SeoNotSetUp />;
  return <ConfiguredExplorer onKeywordsAdded={onKeywordsAdded} />;
}
