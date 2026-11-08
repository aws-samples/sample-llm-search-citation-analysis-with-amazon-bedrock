/**
 * The pages of the SEO section (`/seo/<slug>`), in navigation order.
 *
 * Each page loads lazily, so opening one SEO page never downloads the code of
 * the others. Adding a page is one `seoPage(...)` line here: the SEO router,
 * the sidebar's SEO group and the SEO home cards all read this list.
 */
import {
  lazy, type ComponentType, type LazyExoticComponent
} from 'react';
import {
  CHART_BAR_PATHS, CLIPBOARD_CHECK_PATHS, BOLT_PATHS, GLOBE_PATHS, LINK_PATHS, MAP_PIN_PATHS
} from '../ui/iconPaths';

export const SEO_BASE_PATH = '/seo';

export interface SeoPage {
  /** The URL segment under `/seo`. */
  readonly slug: string;
  readonly label: string;
  /** One line on the SEO home card. */
  readonly summary: string;
  readonly iconPaths: readonly string[];
  /** Tailwind text colour of the sidebar icon (docs/design-system.md §2.2). */
  readonly iconColor: string;
  readonly view: LazyExoticComponent<ComponentType>;
}

type SeoPageText = Pick<SeoPage, 'slug' | 'label' | 'summary' | 'iconPaths' | 'iconColor'>;

function seoPage(text: SeoPageText, load: () => Promise<ComponentType>): SeoPage {
  return {
    ...text,
    view: lazy(() => load().then((view) => ({ default: view }))),
  };
}

export const SEO_PAGES: readonly SeoPage[] = [
  seoPage({
    slug: 'domain',
    label: 'Domain Overview',
    summary: 'Organic traffic, ranking keywords, top pages and competitors of any domain.',
    iconPaths: GLOBE_PATHS,
    iconColor: 'text-indigo-500',
  }, () => import('./DomainOverview/DomainOverviewView').then((module) => module.DomainOverviewView)),
  seoPage({
    slug: 'backlinks',
    label: 'Backlinks',
    summary: 'Links pointing to a domain or page: referring domains, anchors and new or lost links.',
    iconPaths: LINK_PATHS,
    iconColor: 'text-purple-500',
  }, () => import('./Backlinks/BacklinksView').then((module) => module.BacklinksView)),
  seoPage({
    slug: 'rank-tracking',
    label: 'Rank Tracking',
    summary: 'Google positions of your tracked keywords, checked on a schedule or on demand.',
    iconPaths: CHART_BAR_PATHS,
    iconColor: 'text-emerald-500',
  }, () => import('./RankTracking/RankTrackingView').then((module) => module.RankTrackingView)),
  seoPage({
    slug: 'site-audit',
    label: 'Site Audit',
    summary: 'Crawls your site and lists the technical issues of each page.',
    iconPaths: CLIPBOARD_CHECK_PATHS,
    iconColor: 'text-amber-500',
  }, () => import('./SiteAudit/SiteAuditView').then((module) => module.SiteAuditView)),
  seoPage({
    slug: 'performance',
    label: 'Performance',
    summary: 'Lighthouse scores, Core Web Vitals and IndexNow submissions.',
    iconPaths: BOLT_PATHS,
    iconColor: 'text-green-500',
  }, () => import('./Performance/PerformanceView').then((module) => module.PerformanceView)),
  seoPage({
    slug: 'local',
    label: 'Local SEO',
    summary: 'Google Maps results, business profiles and a local rank grid around an address.',
    iconPaths: MAP_PIN_PATHS,
    iconColor: 'text-orange-500',
  }, () => import('./LocalSeo/LocalSeoView').then((module) => module.LocalSeoView)),
];

export function seoPagePath(page: Pick<SeoPage, 'slug'>): string {
  return `${SEO_BASE_PATH}/${page.slug}`;
}
