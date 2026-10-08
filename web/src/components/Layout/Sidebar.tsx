import { Link } from 'react-router-dom';
import type { TabType } from '../../types';
import {
  PlayIcon, CogIcon, EyeIcon, ClockIcon, CloseIcon 
} from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  ARCHIVE_PATHS, CHART_BAR_PATHS, CHAT_BUBBLES_PATHS, LIGHTBULB_PATHS, LINK_PATHS, PENCIL_ALT_PATHS, SEARCH_PATHS 
} from '../ui/iconPaths';

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
  <StrokeIcon className="w-5 h-5" paths={['M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z']} aria-hidden="true" />
);

const BrandIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={['M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4']} aria-hidden="true" />
);

const CitationsIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LINK_PATHS} aria-hidden="true" />
);

const SearchesIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={SEARCH_PATHS} aria-hidden="true" />
);

const RawResponsesIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={ARCHIVE_PATHS} aria-hidden="true" />
);

const KeywordResearchIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={LIGHTBULB_PATHS} aria-hidden="true" />
);

const PromptIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={['M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z']} aria-hidden="true" />
);

const GapsIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4']} aria-hidden="true" />
);

const RecommendationsIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z']} aria-hidden="true" />
);

const ContentStudioIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={PENCIL_ALT_PATHS} aria-hidden="true" />
);

/**
 * Reporting section icon. A document with a chart line on it: signals that
 * Reports take live dashboard data and arrange it into print-ready, shareable
 * deliverables (the section's purpose).
 */
const ReportsIcon = () => (
  <StrokeIcon className="w-5 h-5" paths={['M9 17v-6m3 6V7m3 10v-4M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z']} aria-hidden="true" />
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
          icon: <EyeIcon />,
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
      // Reporting groups print-ready deliverables (executive summary, keyword
      // deep dives, competitor gaps, etc.) under one place. Each report uses
      // the existing print-to-PDF infrastructure but presents the data in a
      // narrative layout aimed at a marketing/exec audience rather than the
      // operational dashboards above.
      title: 'Reporting',
      items: [
        {
          id: 'reports',
          path: '/reports',
          label: 'Reports',
          icon: <ReportsIcon />,
          iconColor: 'text-cyan-500',
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
          icon: <ClockIcon />,
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
          icon: <CogIcon />,
          iconColor: 'text-gray-500',
          badge: keywordsCount 
        },
        {
          // Discovery for the MCP server: how to plug Claude, ChatGPT, Kiro
          // and other assistants into this dashboard's data.
          id: 'ai-assistants',
          path: '/ai-assistants',
          label: 'AI Assistants',
          icon: <StrokeIcon className="w-5 h-5" paths={CHAT_BUBBLES_PATHS} aria-hidden="true" />,
          iconColor: 'text-indigo-500',
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
              <StrokeIcon className="w-5 h-5 text-white dark:text-gray-900" paths={CHART_BAR_PATHS} strokeWidth={2} aria-hidden="true" />
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">Citation Analysis</span>
          </div>
          {/* Close button for mobile */}
          <button 
            onClick={onToggle}
            aria-label="Close sidebar"
            className="lg:hidden p-2 -mr-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <CloseIcon />
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
