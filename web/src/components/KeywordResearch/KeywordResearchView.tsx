import {
  useId, useState
} from 'react';
import { useKeywordResearch } from '../../hooks/useKeywordResearch';
import type {
  Keyword, KeywordResearchItem
} from '../../types';
import { KeywordExpansion } from './KeywordExpansion';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import { ResearchHistory } from './ResearchHistory';
import { ResearchAgent } from './agent/ResearchAgent';
import type { ResearchRunViewProps } from './researchRunView';
import {
  TabBar, TabPanel, type TabDefinition
} from '../ui/TabBar';
import {
  BOLT_PATHS, CLOCK_PATHS, GLOBE_PATHS 
} from '../ui/iconPaths';

type ResearchTab = 'expand' | 'competitor' | 'history' | 'agent';

const RESEARCH_TABS: ReadonlyArray<TabDefinition<ResearchTab>> = [
  {
    id: 'expand',
    label: 'Related Keywords',
    shortLabel: 'Expand',
    iconPaths: BOLT_PATHS,
  },
  {
    id: 'competitor',
    label: 'Competitor Analysis',
    shortLabel: 'Competitor',
    iconPaths: GLOBE_PATHS,
  },
  {
    id: 'history',
    label: 'History',
    shortLabel: 'History',
    iconPaths: CLOCK_PATHS,
  },
  {
    id: 'agent',
    label: 'Research Agent',
    shortLabel: 'Agent',
    iconPaths: ['M5 3l1.5 3.5L10 8l-3.5 1.5L5 13l-1.5-3.5L0 8l3.5-1.5L5 3zm11 2l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5L9.5 11.5 14 9.5 16 5zM8 16l1 2.5 2.5 1-2.5 1L8 23l-1-2.5-2.5-1 2.5-1L8 16z'],
  },
];

interface KeywordResearchViewProps {
  /**
   * Called with the keywords a promotion just created, so the active keyword
   * list picks them up without a refetch.
   */
  onKeywordsAdded?: (created: Keyword[]) => void;
}

export const KeywordResearchView = ({ onKeywordsAdded }: KeywordResearchViewProps = {}) => {
  const [activeTab, setActiveTab] = useState<ResearchTab>('expand');
  const panelId = useId();
  const research = useKeywordResearch();

  // A retry from History jumps to the tab that shows the job's progress.
  const handleHistoryRetry = (job: KeywordResearchItem) => {
    if (job.type === 'agent') {
      setActiveTab('agent');
      return;
    }
    setActiveTab(job.type === 'expansion' ? 'expand' : 'competitor');
    void research.retryResearch(job);
  };

  const runViewProps: ResearchRunViewProps = {
    loading: research.loading,
    error: research.error,
    activeJob: research.activeJob,
    onRetry: research.retryResearch,
    onKeywordsAdded,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-gray-600 text-sm">
          Expand seed terms, analyze competitor websites, or let the research agent plan and run a business&apos;s keyword research.
        </p>
      </div>

      <TabBar tabs={RESEARCH_TABS} activeId={activeTab} onChange={setActiveTab} label="Keyword research" panelId={panelId} />

      <TabPanel id={panelId} activeId={activeTab}>
        {activeTab === 'agent' && <ResearchAgent onKeywordsAdded={onKeywordsAdded} />}
        {activeTab === 'expand' && (
          <KeywordExpansion
            {...runViewProps}
            onExpand={research.expandKeywords}
            result={research.expansionResult}
          />
        )}
        {activeTab === 'competitor' && (
          <CompetitorAnalysis
            {...runViewProps}
            onAnalyze={research.analyzeCompetitor}
            result={research.competitorResult}
          />
        )}
        {activeTab === 'history' && (
          <ResearchHistory
            history={research.history}
            loading={research.historyLoading}
            onDelete={research.deleteResearch}
            onRefresh={research.fetchHistory}
            onRetry={handleHistoryRetry}
            onKeywordsAdded={onKeywordsAdded}
          />
        )}
      </TabPanel>
    </div>
  );
};
