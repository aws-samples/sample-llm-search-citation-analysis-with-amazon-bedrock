import {
  lazy, Suspense, type ReactNode 
} from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { Spinner } from '../ui/Spinner';
import { StatCard } from '../Dashboard/StatCard';
import { ProviderChart } from '../Dashboard/ProviderChart';
import { BrandChart } from '../Dashboard/BrandChart';
import type {
  TabType, Stats, Citations, Search, Keyword, Execution, Schedule 
} from '../../types';

const ExecutionMonitor = lazy(() => import('../Execution/ExecutionMonitor').then(m => ({ default: m.ExecutionMonitor })));
const ScheduleManager = lazy(() => import('../Schedule/ScheduleManager').then(m => ({ default: m.ScheduleManager })));
const BrandsView = lazy(() => import('../Brands/BrandsView').then(m => ({ default: m.BrandsView })));
const CitationsView = lazy(() => import('../Citations').then(m => ({ default: m.CitationsView })));
const SearchesView = lazy(() => import('../Searches').then(m => ({ default: m.SearchesView })));
const SettingsView = lazy(() => import('../Settings').then(m => ({ default: m.SettingsView })));
const RawResponsesExplorer = lazy(() => import('../RawResponses').then(m => ({ default: m.RawResponsesExplorer })));
const KeywordResearchView = lazy(() => import('../KeywordResearch').then(m => ({ default: m.KeywordResearchView })));
const VisibilityDashboard = lazy(() => import('../Visibility').then(m => ({ default: m.VisibilityDashboard })));
const PromptInsights = lazy(() => import('../Insights').then(m => ({ default: m.PromptInsights })));
const CitationGaps = lazy(() => import('../Insights').then(m => ({ default: m.CitationGaps })));
const Recommendations = lazy(() => import('../Insights').then(m => ({ default: m.Recommendations })));
const ContentStudioView = lazy(() => import('../ContentStudio').then(m => ({ default: m.ContentStudioView })));

interface TabContentProps {
  readonly activeTab: TabType;
  readonly stats: Stats | null;
  readonly citations: Citations | null;
  readonly searches: Search[];
  readonly keywords: Keyword[];
  readonly setKeywords: React.Dispatch<React.SetStateAction<Keyword[]>>;
  readonly schedules: Schedule[];
  readonly setSchedules: React.Dispatch<React.SetStateAction<Schedule[]>>;
  readonly execution: Execution | null;
  readonly triggerAnalysis: (keywords?: string[]) => Promise<{
    success: boolean;
    message: string 
  }>;
  readonly startMonitoring: (arn: string, name: string) => void;
  readonly isRunning: boolean;
  readonly rawResponsesPath?: string;
  readonly setActiveTab: (tab: TabType) => void;
  readonly onNavigateToRawResponses: (path: string) => void;
}

function LazyLoadFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner size="lg" />
    </div>
  );
}

function LazyTab({ children }: { readonly children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LazyLoadFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function DashboardStats({ stats }: { readonly stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
      <StatCard title="Total Searches" value={stats?.total_searches ?? 0} icon="🔍" />
      <StatCard title="Total Citations" value={stats?.total_citations ?? 0} icon="📎" />
      <StatCard title="Pages Crawled" value={stats?.total_crawled ?? 0} icon="🕷️" />
      <StatCard title="Unique Keywords" value={stats?.unique_keywords ?? 0} icon="🔑" />
    </div>
  );
}

function DashboardCharts({ citations }: { readonly citations: Citations | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
      <ProviderChart data={citations?.provider_stats ?? []} />
      <BrandChart data={citations?.brand_stats ?? []} />
    </div>
  );
}

function QuickActions({
  citations, keywords, setActiveTab 
}: {
  readonly citations: Citations | null;
  readonly keywords: Keyword[];
  readonly setActiveTab: (tab: TabType) => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">Quick Actions</h3>
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <button
          onClick={() => setActiveTab('execution')}
          className="px-3 sm:px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          </svg>
          <span className="hidden sm:inline">Run Analysis</span>
          <span className="sm:hidden">Run</span>
        </button>
        <button
          onClick={() => setActiveTab('brands')}
          className="px-3 sm:px-4 py-2 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <span className="hidden sm:inline">View Brand Mentions</span>
          <span className="sm:hidden">Brands</span>
        </button>
        <button
          onClick={() => setActiveTab('citations')}
          className="px-3 sm:px-4 py-2 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <span className="hidden sm:inline">View Citations ({citations?.top_urls?.length ?? 0})</span>
          <span className="sm:hidden">Citations</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className="px-3 sm:px-4 py-2 bg-gray-100 text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <span className="hidden sm:inline">Manage Keywords ({keywords.length})</span>
          <span className="sm:hidden">Keywords</span>
        </button>
      </div>
    </div>
  );
}

function DashboardContent({
  stats, citations, keywords, setActiveTab 
}: {
  readonly stats: Stats | null;
  readonly citations: Citations | null;
  readonly keywords: Keyword[];
  readonly setActiveTab: (tab: TabType) => void;
}) {
  return (
    <ErrorBoundary>
      <DashboardStats stats={stats} />
      <DashboardCharts citations={citations} />
      <QuickActions citations={citations} keywords={keywords} setActiveTab={setActiveTab} />
    </ErrorBoundary>
  );
}

export function TabContent(props: TabContentProps) {
  const {
    activeTab,
    stats,
    citations,
    searches,
    keywords,
    setKeywords,
    schedules,
    setSchedules,
    execution,
    triggerAnalysis,
    startMonitoring,
    isRunning,
    rawResponsesPath,
    setActiveTab,
    onNavigateToRawResponses,
  } = props;

  if (activeTab === 'dashboard') {
    return <DashboardContent stats={stats} citations={citations} keywords={keywords} setActiveTab={setActiveTab} />;
  }

  const tabComponents: Partial<Record<TabType, ReactNode>> = {
    visibility: <VisibilityDashboard keywords={keywords} />,
    brands: <BrandsView keywords={keywords} />,
    citations: <CitationsView citations={citations?.top_urls ?? []} onNavigateToRawResponses={onNavigateToRawResponses} />,
    'prompt-insights': <PromptInsights />,
    'citation-gaps': <CitationGaps keywords={keywords} />,
    recommendations: <Recommendations />,
    'content-studio': <ContentStudioView />,
    execution: <ExecutionMonitor execution={execution} triggerAnalysis={triggerAnalysis} keywordsCount={keywords.length} keywords={keywords} />,
    schedule: <ScheduleManager schedules={schedules} setSchedules={setSchedules} />,
    settings: <SettingsView keywords={keywords} setKeywords={setKeywords} />,
    searches: (
      <SearchesView
        searches={searches}
        isRunning={isRunning}
        onRerunSuccess={(executionArn, executionName) => {
          startMonitoring(executionArn, executionName);
          setActiveTab('execution');
        }}
        onNavigateToRawResponses={onNavigateToRawResponses}
      />
    ),
    'raw-responses': <RawResponsesExplorer initialPath={rawResponsesPath} />,
    'keyword-research': <KeywordResearchView />,
  };

  const component = tabComponents[activeTab];
  if (!component) return null;

  return <LazyTab>{component}</LazyTab>;
}
