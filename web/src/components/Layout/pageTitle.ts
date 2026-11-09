/**
 * The header title of each page. A page of a sidebar group (an SEO page, a Settings section) is named with its
 * group, so `/seo/backlinks` reads "SEO › Backlinks" instead of only "SEO".
 */
import {
  SEO_PAGES, seoPagePath
} from '../Seo/seoPages';
import {
  SETTINGS_NAV, sectionFromPath
} from '../Settings/settingsSections';
import type { TabType } from '../../types';

const PAGE_TITLES: Record<TabType, string> = {
  dashboard: 'Dashboard',
  visibility: 'Visibility Dashboard',
  brands: 'Brand Mentions',
  citations: 'Citations',
  'prompt-insights': 'Prompt Insights',
  'citation-gaps': 'Citation Gap Analysis',
  recommendations: 'Action Center',
  'content-studio': 'Content Studio',
  reports: 'Reports',
  execution: 'Run Analysis',
  schedule: 'Schedule',
  'keyword-research': 'Keyword Research',
  seo: 'SEO',
  settings: 'Settings',
  searches: 'Recent Searches',
  'raw-responses': 'Raw Responses',
  exports: 'Exports',
};

export interface PageTitle {
  /** The sidebar group the page belongs to, when it is one of its pages. */
  readonly group?: string;
  readonly title: string;
  /**
   * The page draws its own title (`<h1>`) and its own "Save as PDF" (a report page), so the app bar's title is not
   * a heading and its PDF button is left out.
   */
  readonly ownHeader?: boolean;
}

/** The SEO page or Settings section `pathname` opens, by its sidebar label; `undefined` for the SEO overview. */
function groupPageLabel(tab: 'seo' | 'settings', pathname: string): string | undefined {
  if (tab === 'settings') {
    const section = sectionFromPath(pathname);
    return SETTINGS_NAV.find((entry) => entry.id === section)?.label;
  }
  return SEO_PAGES.find((page) => pathname === seoPagePath(page) || pathname.startsWith(`${seoPagePath(page)}/`))?.label;
}

export function pageTitle(tab: TabType, pathname: string): PageTitle {
  const title = PAGE_TITLES[tab];
  if (tab === 'reports') return pathname === '/reports' || pathname === '/reports/' ? { title } : {
    title,
    ownHeader: true,
  };
  if (tab !== 'seo' && tab !== 'settings') return { title };
  const label = groupPageLabel(tab, pathname);
  return label === undefined ? { title } : {
    group: title,
    title: label,
  };
}

/** The title as one line of text ("SEO › Backlinks"), for the print header. */
export function pageTitleText({
  group, title
}: PageTitle): string {
  return group === undefined ? title : `${group} › ${title}`;
}
