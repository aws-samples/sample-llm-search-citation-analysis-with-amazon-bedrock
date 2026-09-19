import { useState } from 'react';
import { useKeywordResearch } from '../../hooks/useKeywordResearch';
import type {
  Keyword, KeywordResearchItem
} from '../../types';
import { KeywordExpansion } from './KeywordExpansion';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import { ResearchHistory } from './ResearchHistory';
import { ResearchAgent } from './agent/ResearchAgent';

type ResearchTab = 'agent' | 'expand' | 'competitor' | 'history';

const SHORT_LABELS: Record<ResearchTab, string> = {
  agent: 'Agent',
  expand: 'Expand',
  competitor: 'Competitor',
  history: 'History',
};

interface KeywordResearchViewProps {
  /**
   * Called with the keywords a promotion just created, so the active keyword
   * list picks them up without a refetch.
   */
  onKeywordsAdded?: (created: Keyword[]) => void;
}

export const KeywordResearchView = ({ onKeywordsAdded }: KeywordResearchViewProps = {}) => {
  const [activeTab, setActiveTab] = useState<ResearchTab>('agent');
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

  const tabs: {
    id: ResearchTab;
    label: string;
    icon: React.ReactNode 
  }[] = [
    {
      id: 'agent',
      label: 'Research Agent',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3l1.5 3.5L10 8l-3.5 1.5L5 13l-1.5-3.5L0 8l3.5-1.5L5 3zm11 2l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5L9.5 11.5 14 9.5 16 5zM8 16l1 2.5 2.5 1-2.5 1L8 23l-1-2.5-2.5-1 2.5-1L8 16z" />
        </svg>
      ),
    },
    {
      id: 'expand',
      label: 'Related Keywords',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: 'competitor',
      label: 'Competitor Analysis',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'History',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-gray-600 text-sm">
          Let the research agent plan and run a hotel&apos;s keyword research, expand seed terms, or analyze competitor websites.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-2 sm:gap-4 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{SHORT_LABELS[tab.id]}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'agent' && <ResearchAgent onKeywordsAdded={onKeywordsAdded} />}
        {activeTab === 'expand' && (
          <KeywordExpansion
            onExpand={research.expandKeywords}
            loading={research.loading}
            result={research.expansionResult}
            error={research.error}
            activeJob={research.activeJob}
            onRetry={research.retryResearch}
            onKeywordsAdded={onKeywordsAdded}
          />
        )}
        {activeTab === 'competitor' && (
          <CompetitorAnalysis
            onAnalyze={research.analyzeCompetitor}
            loading={research.loading}
            result={research.competitorResult}
            error={research.error}
            activeJob={research.activeJob}
            onRetry={research.retryResearch}
            onKeywordsAdded={onKeywordsAdded}
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
      </div>
    </div>
  );
};
