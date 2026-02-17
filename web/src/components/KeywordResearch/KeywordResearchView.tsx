import { useState } from 'react';
import { useKeywordResearch } from '../../hooks/useKeywordResearch';
import { KeywordExpansion } from './KeywordExpansion';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import { ResearchHistory } from './ResearchHistory';

type ResearchTab = 'expand' | 'competitor' | 'history';

export const KeywordResearchView = () => {
  const [activeTab, setActiveTab] = useState<ResearchTab>('expand');
  const research = useKeywordResearch();

  const tabs: {
    id: ResearchTab;
    label: string;
    icon: React.ReactNode 
  }[] = [
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
          Discover keyword opportunities by expanding seed terms or analyzing competitor websites.
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
              <span className="sm:hidden">{(() => {
                if (tab.id === 'expand') return 'Expand';
                if (tab.id === 'competitor') return 'Competitor';
                return 'History';
              })()}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'expand' && (
          <KeywordExpansion
            onExpand={research.expandKeywords}
            loading={research.loading}
            result={research.expansionResult}
            error={research.error}
          />
        )}
        {activeTab === 'competitor' && (
          <CompetitorAnalysis
            onAnalyze={research.analyzeCompetitor}
            loading={research.loading}
            result={research.competitorResult}
            error={research.error}
          />
        )}
        {activeTab === 'history' && (
          <ResearchHistory
            history={research.history}
            loading={research.historyLoading}
            onDelete={research.deleteResearch}
            onRefresh={research.fetchHistory}
          />
        )}
      </div>
    </div>
  );
};
