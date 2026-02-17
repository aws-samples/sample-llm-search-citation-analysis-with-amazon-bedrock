import {
  useState, useEffect 
} from 'react';
import {
  BrowserRouter, Routes, Route, useNavigate, useLocation 
} from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import { signOut } from 'aws-amplify/auth';
import {
  useAuthenticator, Authenticator 
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useDashboardData } from './hooks/useDashboardData';
import { useExecutionPolling } from './hooks/useExecutionPolling';
import { Sidebar } from './components/Layout/Sidebar';
import { TabContent } from './components/Layout/TabContent';
import { ConfirmModal } from './components/ui/Modal';
import { AboutModal } from './components/About';
import { ThemeToggle } from './components/ui/ThemeToggle';
import { Spinner } from './components/ui/Spinner';
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
  'content-studio': '/content-studio',
  searches: '/searches',
  'raw-responses': '/raw-responses',
  execution: '/execution',
  schedule: '/schedule',
  settings: '/settings',
};

const PATH_TO_TAB: Record<string, TabType> = Object.entries(TAB_TO_PATH).reduce<Record<string, TabType>>(
  (acc, [tab, path]) => ({
    ...acc,
    [path]: tab as TabType 
  }),
  {}
);

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
                placeholder: 'Enter your email address' 
              } 
            },
            signUp: {
              email: {
                label: 'Email Address',
                placeholder: 'Enter your email address',
                isRequired: true,
                order: 1 
              },
              password: {
                label: 'Password',
                placeholder: 'Enter your password',
                isRequired: true,
                order: 2 
              },
              confirm_password: {
                label: 'Confirm Password',
                placeholder: 'Confirm your password',
                isRequired: true,
                order: 3 
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
        <Spinner size="lg" className="mx-auto mb-4 text-gray-400" />
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

const PAGE_TITLES: Record<TabType, string> = {
  dashboard: 'Dashboard',
  visibility: 'Visibility Dashboard',
  brands: 'Brand Mentions',
  citations: 'Citations',
  'prompt-insights': 'Prompt Insights',
  'citation-gaps': 'Citation Gap Analysis',
  recommendations: 'Action Center',
  'content-studio': 'Content Studio',
  execution: 'Run Analysis',
  schedule: 'Schedule',
  'keyword-research': 'Keyword Research',
  settings: 'Settings',
  searches: 'Recent Searches',
  'raw-responses': 'Raw Responses',
};

function MainApp() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const activeTab = PATH_TO_TAB[location.pathname] ?? 'dashboard';
  
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [rawResponsesPath, setRawResponsesPath] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const {
    stats, citations, searches, keywords, setKeywords, loading, error, lastUpdate, refetch 
  } = useDashboardData();
  const {
    execution, triggerAnalysis, startMonitoring, isRunning 
  } = useExecutionPolling(refetch);

  // Clear rawResponsesPath when navigating away from raw-responses
  useEffect(() => {
    if (location.pathname !== '/raw-responses') {
      setRawResponsesPath(undefined);
    }
  }, [location.pathname]);

  const handleTabChange = (tab: TabType) => {
    const targetPath = TAB_TO_PATH[tab];
    if (isRunning && activeTab === 'execution') {
      setPendingPath(targetPath);
      setShowLeaveConfirm(true);
      return;
    }
    navigate(targetPath);
  };

  const handleNavigateToRawResponses = (path: string) => {
    setRawResponsesPath(path);
    navigate('/raw-responses');
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

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-gray-600 dark:text-gray-400">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-xl text-red-600 dark:text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        keywordsCount={keywords.length}
        schedulesCount={schedules.length}
        isRunning={isRunning}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <main className="lg:ml-64 min-h-screen">
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 -ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white truncate">{PAGE_TITLES[activeTab]}</h1>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
            {loading && (
              <span className="text-sm text-gray-400 flex items-center gap-2">
                <Spinner size="sm" />
                <span className="hidden sm:inline">Refreshing</span>
              </span>
            )}
            <ThemeToggle />
            <button
              onClick={async () => {
                try {
                  await signOut();
                } catch (error) {
                  console.error('Sign out error:', error);
                }
              }}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Sign out"
            >
              <span className="hidden sm:inline">Sign Out</span>
              <svg className="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
            <button
              onClick={() => setShowAbout(true)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="About this application"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <TabContent
              activeTab={activeTab}
              stats={stats}
              citations={citations}
              searches={searches}
              keywords={keywords}
              setKeywords={setKeywords}
              schedules={schedules}
              setSchedules={setSchedules}
              execution={execution}
              triggerAnalysis={triggerAnalysis}
              startMonitoring={startMonitoring}
              isRunning={isRunning}
              rawResponsesPath={rawResponsesPath}
              setActiveTab={setActiveTab}
              onNavigateToRawResponses={handleNavigateToRawResponses}
            />
          </div>
        </div>
      </main>

      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => {
          setShowLeaveConfirm(false);
          setPendingPath(null);
        }}
        onConfirm={confirmLeaveExecution}
        title="Leave Execution Page"
        message="An analysis is currently running. Are you sure you want to leave this page? (The analysis will continue in the background)"
        confirmText="Leave"
        confirmVariant="primary"
      />

      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  );
}

function AuthenticatedRoutes() {
  return (
    <Routes>
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
