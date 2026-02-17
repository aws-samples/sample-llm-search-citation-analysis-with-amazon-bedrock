import { Link } from 'react-router-dom';
import type { TabType } from '../../types';

interface NavItem {
  id: TabType;
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  iconColor?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  keywordsCount: number;
  schedulesCount: number;
  isRunning: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

// Icons
const DashboardIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </svg>
);

const BrandIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

const CitationsIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
);

const PlayIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ScheduleIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const SearchesIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const RawResponsesIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);

const KeywordResearchIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const VisibilityIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const PromptIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const GapsIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

const RecommendationsIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ContentStudioIcon = () => (
  <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

export const Sidebar = ({
  activeTab, onTabChange, keywordsCount, schedulesCount, isRunning, isOpen, onToggle 
}: SidebarProps) => {
  // Close sidebar on mobile when tab changes
  const handleTabClick = (tab: TabType) => {
    onTabChange(tab);
    // Close sidebar on mobile after selection
    if (window.innerWidth < 1024) {
      onToggle();
    }
  };

  const navSections: NavSection[] = [
    {
      title: 'Insights',
      items: [
        {
          id: 'dashboard',
          path: '/',
          label: 'Dashboard',
          icon: <DashboardIcon />,
          iconColor: 'text-blue-500',
        },
        {
          id: 'visibility',
          path: '/visibility',
          label: 'Visibility',
          icon: <VisibilityIcon />,
          iconColor: 'text-indigo-500',
        },
        {
          id: 'brands',
          path: '/brands',
          label: 'Brand Mentions',
          icon: <BrandIcon />,
          iconColor: 'text-violet-500',
        },
        {
          id: 'citations',
          path: '/citations',
          label: 'Citations',
          icon: <CitationsIcon />,
          iconColor: 'text-purple-500',
        },
        {
          id: 'prompt-insights',
          path: '/prompt-insights',
          label: 'Prompt Insights',
          icon: <PromptIcon />,
          iconColor: 'text-fuchsia-500',
        },
        {
          id: 'citation-gaps',
          path: '/citation-gaps',
          label: 'Citation Gaps',
          icon: <GapsIcon />,
          iconColor: 'text-rose-500',
        },
        {
          id: 'recommendations',
          path: '/recommendations',
          label: 'Action Center',
          icon: <RecommendationsIcon />,
          iconColor: 'text-emerald-500',
        },
      ],
    },
    {
      title: 'Research',
      items: [
        {
          id: 'keyword-research',
          path: '/keyword-research',
          label: 'Keyword Research',
          icon: <KeywordResearchIcon />,
          iconColor: 'text-amber-500',
        },
      ],
    },
    {
      title: 'Content',
      items: [
        {
          id: 'content-studio',
          path: '/content-studio',
          label: 'Content Studio',
          icon: <ContentStudioIcon />,
          iconColor: 'text-teal-500',
        },
      ],
    },
    {
      title: 'Data',
      items: [
        {
          id: 'searches',
          path: '/searches',
          label: 'Recent Searches',
          icon: <SearchesIcon />,
          iconColor: 'text-sky-500',
        },
        {
          id: 'raw-responses',
          path: '/raw-responses',
          label: 'Raw Responses',
          icon: <RawResponsesIcon />,
          iconColor: 'text-slate-500',
        },
      ],
    },
    {
      title: 'Operations',
      items: [
        {
          id: 'execution',
          path: '/execution',
          label: 'Run Analysis',
          icon: <PlayIcon />,
          iconColor: 'text-green-500',
        },
        {
          id: 'schedule',
          path: '/schedule',
          label: 'Schedule',
          icon: <ScheduleIcon />,
          iconColor: 'text-orange-500',
          badge: schedulesCount 
        },
      ],
    },
    {
      title: 'Configuration',
      items: [
        {
          id: 'settings',
          path: '/settings',
          label: 'Settings',
          icon: <SettingsIcon />,
          iconColor: 'text-gray-500',
          badge: keywordsCount 
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      <aside className={`fixed left-0 top-0 h-screen w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col z-50 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        {/* Logo / Brand */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 dark:bg-white rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white dark:text-gray-900" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">Citation Analysis</span>
          </div>
          {/* Close button for mobile */}
          <button 
            onClick={onToggle}
            aria-label="Close sidebar"
            className="lg:hidden p-2 -mr-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="flex-1 px-3 py-4 overflow-y-auto">
          {navSections.map((section, sectionIdx) => (
            <div key={section.title} className={sectionIdx > 0 ? 'mt-6' : ''}>
              <div className="px-3 mb-2">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {section.title}
                </span>
              </div>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      onClick={(e) => {
                        // Let onTabChange handle the navigation logic (for execution confirmation)
                        e.preventDefault();
                        handleTabClick(item.id);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative ${
                        activeTab === item.id
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      <span className={item.iconColor ?? (activeTab === item.id ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500')}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                      
                      {/* Badge */}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                          {item.badge}
                        </span>
                      )}
                      
                      {/* Running indicator for execution */}
                      {item.id === 'execution' && isRunning && (
                        <span className="ml-auto flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

      </aside>
    </>
  );
};
