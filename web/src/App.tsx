import {
  useState, useEffect
} from 'react';
import {
  BrowserRouter, Navigate, Routes, Route, useNavigate, useLocation
} from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import {
  useAuthenticator, Authenticator
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useDashboardData } from './hooks/useDashboardData';
import { PanelLoadError } from './components/Dashboard/PanelLoadError';
import { useExecutionPolling } from './hooks/useExecutionPolling';
import { usePrintMode } from './hooks/usePrintMode';
import { KEYWORD_RECONCILIATION_CONTEXT } from './hooks/usePromoteKeywords';
import { Sidebar } from './components/Layout/Sidebar';
import { TabContent } from './components/Layout/TabContent';
import { DashboardGate } from './components/Layout/DashboardGate';
import { AppHeader } from './components/Layout/AppHeader';
import { pageTitle } from './components/Layout/pageTitle';
import { ReportsRouter } from './components/Reports/ReportsRouter';
import { SEO_BASE_PATH } from './components/Seo/seoPages';
import { ConfirmModal } from './components/ui/Modal';
import { AboutModal } from './components/About';
import { OnboardingModal } from './components/Onboarding';
import { ProviderHealthBanner } from './components/ProviderHealth';
import { MarketSelectionProvider } from './components/Markets/MarketSelectionProvider';
import { Spinner } from './components/ui/Spinner';
import type { SettingsTab } from './components/Settings';
import {
  isSettingsPath, settingsPath
} from './components/Settings/settingsSections';
import type {
  TabType, Schedule
} from './types';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
    },
  },
});

const TAB_TO_PATH: Record<TabType, string> = {
  dashboard: '/',
  visibility: '/visibility',
  brands: '/brands',
  citations: '/citations',
  'prompt-insights': '/prompt-insights',
  'citation-gaps': '/citation-gaps',
  recommendations: '/recommendations',
  'keyword-research': '/keyword-research',
  seo: SEO_BASE_PATH,
  'content-studio': '/content-studio',
  reports: '/reports',
  searches: '/searches',
  'raw-responses': '/raw-responses',
  execution: '/execution',
  schedule: '/schedule',
  settings: '/settings',
};

const PATH_TO_TAB: Record<string, TabType> = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([tab, path]) => [path, tab as TabType])
);

/**
 * Resolve a route pathname back to its TabType. Sub-paths under `/reports/`
 * (e.g. `/reports/keyword/foo`) all resolve to the `reports` tab so the
 * sidebar stays highlighted when navigating between individual reports;
 * `/seo/...` pages resolve to `seo` the same way.
 */
function resolveActiveTab(pathname: string): TabType {
  if (pathname.startsWith('/reports')) return 'reports';
  if (pathname === SEO_BASE_PATH || pathname.startsWith(`${SEO_BASE_PATH}/`)) return 'seo';
  if (isSettingsPath(pathname)) return 'settings';
  return PATH_TO_TAB[pathname] ?? 'dashboard';
}

function Login() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Citation Analysis</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Sign in to access the dashboard</p>
        </div>
        <Authenticator
          hideSignUp={true}
          loginMechanisms={['email']}
          formFields={{
            signIn: {
              username: {
                label: 'Email Address',
                placeholder: 'Enter your email address',
              },
            },
            signUp: {
              email: {
                label: 'Email Address',
                placeholder: 'Enter your email address',
                isRequired: true,
                order: 1,
              },
              password: {
                label: 'Password',
                placeholder: 'Enter your password',
                isRequired: true,
                order: 2,
              },
              confirm_password: {
                label: 'Confirm Password',
                placeholder: 'Confirm your password',
                isRequired: true,
                order: 3,
              },
            },
          }}
        />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-4 text-gray-500" />
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeTab = resolveActiveTab(location.pathname);
  const isReportRoute = location.pathname.startsWith('/reports');

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [rawResponsesPath, setRawResponsesPath] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const {
    stats,
    citations,
    searches,
    searchesNextToken,
    keywords,
    setKeywords,
    loading,
    error,
    lastUpdate,
    refetch,
    reconcileKeywords,
    panels,
    retryPanel,
  } = useDashboardData();
  const {
    execution, triggerAnalysis, isRunning
  } = useExecutionPolling(refetch);

  // Print mode: when ?print=1 is in the URL we hide the sidebar/header chrome
  // and auto-trigger the browser print dialog once data has loaded. On
  // `/reports/*` routes we leave the auto-print scheduling to the report
  // component itself, since report data is loaded inside the report (and is
  // not represented by the dashboard's `stats` flag).
  const { isPrintMode } = usePrintMode({ready: isReportRoute ? false : !loading && Boolean(stats),});

  // Clear rawResponsesPath when navigating away from raw-responses
  useEffect(() => {
    if (location.pathname !== '/raw-responses') {
      setRawResponsesPath(undefined);
    }
  }, [location.pathname]);

  const handleNavigate = (targetPath: string) => {
    if (isRunning && activeTab === 'execution') {
      setPendingPath(targetPath);
      setShowLeaveConfirm(true);
      return;
    }
    navigate(targetPath);
  };

  const handleTabChange = (tab: TabType) => handleNavigate(TAB_TO_PATH[tab]);

  const handleNavigateToRawResponses = (path: string) => {
    setRawResponsesPath(path);
    navigate('/raw-responses');
  };

  const handleNavigateToSettings = (tab: SettingsTab) => {
    navigate(settingsPath(tab));
  };

  const confirmLeaveExecution = () => {
    if (pendingPath) {
      navigate(pendingPath);
      setPendingPath(null);
    }
    setShowLeaveConfirm(false);
  };

  const setActiveTab = (tab: TabType) => {
    navigate(TAB_TO_PATH[tab]);
  };

  return (
    <DashboardGate loading={loading} stats={stats} error={error}>
      <MarketSelectionProvider keywords={keywords}>
        <div className={`min-h-screen bg-gray-50 dark:bg-gray-900 ${isPrintMode ? 'print-mode' : ''}`}>
          {!isPrintMode && (
            <Sidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onNavigate={handleNavigate}
              keywordsCount={keywords.length}
              schedulesCount={schedules.length}
              isRunning={isRunning}
              isOpen={sidebarOpen}
              onToggle={() => setSidebarOpen(!sidebarOpen)}
            />
          )}

          <main className={`${isPrintMode ? '' : 'lg:ml-64 lg:peer-data-[collapsed=true]:ml-16 transition-[margin] duration-300'} min-h-screen`}>
            <AppHeader
              isPrintMode={isPrintMode}
              title={pageTitle(activeTab, location.pathname)}
              lastUpdate={lastUpdate}
              refreshing={loading}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onShowAbout={() => setShowAbout(true)}
            />

            <div className="p-4 sm:p-6 lg:p-8">
              <div className="max-w-7xl mx-auto">
                {/* Sits above the view content so a silently failing provider is
                  visible from every tab, not just Settings. Suppressed in print
                  mode, like the other app-wide chrome. */}
                {!isPrintMode && (
                  <ProviderHealthBanner onNavigateToProviders={() => handleNavigateToSettings('providers')} />
                )}

                {/* Keyword lists feed every tab and report, so their failure shows everywhere. */}
                <PanelLoadError panel="keywords" panels={panels} onRetry={retryPanel} spacingClassName="mb-4 " />

                <KEYWORD_RECONCILIATION_CONTEXT.Provider value={reconcileKeywords}>
                  {isReportRoute ? (
                    <ReportsRouter keywords={keywords} />
                  ) : (
                    <TabContent
                      activeTab={activeTab}
                      stats={stats}
                      citations={citations}
                      searches={searches}
                      searchesNextToken={searchesNextToken}
                      keywords={keywords}
                      setKeywords={setKeywords}
                      schedules={schedules}
                      setSchedules={setSchedules}
                      execution={execution}
                      triggerAnalysis={triggerAnalysis}
                      rawResponsesPath={rawResponsesPath}
                      setActiveTab={setActiveTab}
                      onNavigateToRawResponses={handleNavigateToRawResponses}
                      panels={panels}
                      retryPanel={retryPanel}
                    />
                  )}
                </KEYWORD_RECONCILIATION_CONTEXT.Provider>
              </div>
            </div>
          </main>

          <ConfirmModal
            isOpen={showLeaveConfirm}
            onClose={() => { setShowLeaveConfirm(false); setPendingPath(null); }}
            onConfirm={confirmLeaveExecution}
            title="Leave Run Analysis?"
            message="A run is in progress. It keeps running if you leave, and its results appear on the other pages as they arrive."
            confirmText="Leave"
            confirmVariant="primary"
          />

          {/* First-run setup guide; mounts app-wide so it is visible regardless
            of which tab is active when the setup status resolves. */}
          {!isPrintMode && (
            <OnboardingModal
              keywordsCount={keywords.length}
              hasRunAnalysis={(stats?.total_searches ?? 0) > 0}
              setActiveTab={setActiveTab}
              onNavigateToSettings={handleNavigateToSettings}
            />
          )}

          <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
        </div>
      </MarketSelectionProvider>
    </DashboardGate>
  );
}

function AuthenticatedRoutes() {
  return (
    <Routes>
      {/* The AI assistants guide used to be its own page; old links and bookmarks land on its Settings section. */}
      <Route path="/ai-assistants" element={<Navigate to={settingsPath('ai-assistants')} replace />} />
      <Route path="/*" element={<MainApp />} />
    </Routes>
  );
}

export function App() {
  const { authStatus } = useAuthenticator((context) => [context.authStatus]);

  if (authStatus === 'configuring') {
    return <Loading />;
  }

  if (authStatus === 'unauthenticated') {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <AuthenticatedRoutes />
    </BrowserRouter>
  );
}
