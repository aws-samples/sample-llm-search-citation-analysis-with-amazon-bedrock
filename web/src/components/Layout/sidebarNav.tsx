/**
 * The sidebar's navigation: its sections, their entries and the entries'
 * icons (24×24 outline glyphs drawn by `StrokeIcon`, see the design system §6).
 */
import type { ReactNode } from 'react';
import type { TabType } from '../../types';
import {
  PlayIcon, CogIcon, EyeIcon, ClockIcon
} from '../ui';
import { StrokeIcon } from '../ui/StrokeIcon';
import {
  ARCHIVE_PATHS, DOWNLOAD_PATHS, LIGHTBULB_PATHS, LINK_PATHS, PENCIL_ALT_PATHS, SEARCH_PATHS, TREND_UP_PATHS
} from '../ui/iconPaths';
import {
  SEO_CHILDREN, settingsChildren, type NavChild, type SettingsChildrenInput
} from './sidebarChildren';

export interface NavItem {
  readonly id: TabType;
  readonly path: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly badge?: number;
  readonly iconColor?: string;
  /** The pages the entry opens to in the sidebar (SEO, Settings); the entry itself links to the first. */
  readonly children?: readonly NavChild[];
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

const navIcon = (paths: readonly string[]) => <StrokeIcon className="w-5 h-5" paths={paths} aria-hidden="true" />;

const DASHBOARD_PATHS = ['M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'];
const BRAND_PATHS = ['M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'];
const PROMPT_PATHS = ['M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'];
const GAPS_PATHS = ['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4'];
const RECOMMENDATIONS_PATHS = ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'];
/**
 * Reporting icon: a document with a chart line on it, for Reports taking live
 * dashboard data and arranging it into print-ready, shareable deliverables.
 */
const REPORTS_PATHS = ['M9 17v-6m3 6V7m3 10v-4M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z'];

export interface NavInput {
  readonly schedulesCount: number;
  /** Finished exports the member has not opened yet (the Exports badge). */
  readonly exportsUnseen: number;
  /** What the Settings group lists: the member's sections, the keyword and market counts, the attention dots. */
  readonly settings: SettingsChildrenInput;
}

/** The sections in display order; Schedule carries the schedule count, Exports the unseen exports, SEO and Settings open to their pages. */
export function buildNavSections({
  schedulesCount, exportsUnseen, settings
}: NavInput): NavSection[] {
  return [
    {
      title: 'Insights',
      items: [
        {
          id: 'dashboard',
          path: '/',
          label: 'Dashboard',
          icon: navIcon(DASHBOARD_PATHS),
          iconColor: 'text-blue-500',
        },
        {
          id: 'visibility',
          path: '/visibility',
          label: 'Visibility',
          icon: <EyeIcon />,
          iconColor: 'text-blue-500',
        },
        {
          id: 'brands',
          path: '/brands',
          label: 'Brand Mentions',
          icon: navIcon(BRAND_PATHS),
          iconColor: 'text-violet-500',
        },
        {
          id: 'citations',
          path: '/citations',
          label: 'Citations',
          icon: navIcon(LINK_PATHS),
          iconColor: 'text-violet-500',
        },
        {
          id: 'prompt-insights',
          path: '/prompt-insights',
          label: 'Prompt Insights',
          icon: navIcon(PROMPT_PATHS),
          iconColor: 'text-gray-500',
        },
        {
          id: 'citation-gaps',
          path: '/citation-gaps',
          label: 'Citation Gaps',
          icon: navIcon(GAPS_PATHS),
          iconColor: 'text-gray-500',
        },
        {
          id: 'recommendations',
          path: '/recommendations',
          label: 'Action Center',
          icon: navIcon(RECOMMENDATIONS_PATHS),
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
          icon: navIcon(LIGHTBULB_PATHS),
          iconColor: 'text-amber-500',
        },
        {
          id: 'seo',
          path: '/seo',
          label: 'SEO',
          // A rising trend line, for Google organic positions and traffic.
          icon: navIcon(TREND_UP_PATHS),
          iconColor: 'text-gray-600',
          children: SEO_CHILDREN,
        },
      ],
    },
    {
      title: 'Content',
      items: [{
        id: 'content-studio',
        path: '/content-studio',
        label: 'Content Studio',
        icon: navIcon(PENCIL_ALT_PATHS),
        iconColor: 'text-gray-500',
      }],
    },
    {
      // Print-ready deliverables (executive summary, keyword deep dives,
      // competitor gaps, ...) aimed at a marketing/exec audience.
      title: 'Reporting',
      items: [{
        id: 'reports',
        path: '/reports',
        label: 'Reports',
        icon: navIcon(REPORTS_PATHS),
        iconColor: 'text-gray-500',
      }],
    },
    {
      title: 'Data',
      items: [
        {
          id: 'searches',
          path: '/searches',
          label: 'Recent Searches',
          icon: navIcon(SEARCH_PATHS),
          iconColor: 'text-gray-500',
        },
        {
          id: 'raw-responses',
          path: '/raw-responses',
          label: 'Raw Responses',
          icon: navIcon(ARCHIVE_PATHS),
          iconColor: 'text-gray-500',
        },
        {
          id: 'exports',
          path: '/exports',
          label: 'Exports',
          icon: navIcon(DOWNLOAD_PATHS),
          iconColor: 'text-blue-500',
          badge: exportsUnseen,
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
          iconColor: 'text-emerald-500',
        },
        {
          id: 'schedule',
          path: '/schedule',
          label: 'Schedule',
          icon: <ClockIcon />,
          iconColor: 'text-amber-500',
          badge: schedulesCount,
        },
      ],
    },
    {
      title: 'Configuration',
      items: [{
        id: 'settings',
        path: '/settings',
        label: 'Settings',
        icon: <CogIcon />,
        iconColor: 'text-gray-500',
        children: settingsChildren(settings),
      }],
    },
  ];
}

/**
 * Classes of a sidebar icon: neutral grey, and blue for the open page, in both themes (design-system §2.2).
 * `iconColor` is kept on the items for other uses but no longer tints the sidebar.
 */
export function navIconClass(_iconColor: string | undefined, active: boolean): string {
  return active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400';
}
