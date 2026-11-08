/**
 * The pages a sidebar group opens to: SEO (its overview, then every SEO page) and Settings (its sections,
 * the admin-only ones for admins). Each child is a link with its own URL; a count shows as a badge and setup
 * that blocks analysis runs as an attention dot.
 */
import {
  SEO_BASE_PATH, SEO_PAGES, seoPagePath
} from '../Seo/seoPages';
import {
  ADMIN_ONLY_SECTIONS, SETTINGS_NAV, sectionFromPath, settingsPath, type SettingsTab
} from '../Settings/settingsSections';
import { TREND_UP_PATHS } from '../ui/iconPaths';

export interface NavChild {
  /** Stable key; also the `data-nav-child` hook for tests. */
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly iconPaths: readonly string[];
  readonly iconColor: string;
  readonly badge?: number;
  readonly needsAttention?: boolean;
}

/** The child of `group` that `pathname` opens: an SEO page's slug or the overview; a Settings section (Keywords for `/settings`). */
export function activeChildId(group: 'seo' | 'settings', pathname: string): string {
  if (group === 'settings') return sectionFromPath(pathname);
  const page = SEO_PAGES.find((candidate) => pathname === seoPagePath(candidate)
    || pathname.startsWith(`${seoPagePath(candidate)}/`));
  return page?.slug ?? 'overview';
}

export const SEO_CHILDREN: readonly NavChild[] = [
  {
    id: 'overview',
    path: SEO_BASE_PATH,
    label: 'Overview',
    iconPaths: TREND_UP_PATHS,
    iconColor: 'text-blue-500',
  },
  ...SEO_PAGES.map((page) => ({
    id: page.slug,
    path: seoPagePath(page),
    label: page.label,
    iconPaths: page.iconPaths,
    iconColor: page.iconColor,
  })),
];

export interface SettingsChildrenInput {
  readonly isAdmin: boolean;
  readonly keywordsCount: number;
  /** Configured markets; `null` until they are read. */
  readonly marketCount: number | null;
  /** Sections whose setup blocks analysis runs, as the Settings page last published them. */
  readonly attention: ReadonlySet<SettingsTab>;
}

function settingsBadge(id: SettingsTab, input: SettingsChildrenInput): number | undefined {
  if (id === 'keywords') return input.keywordsCount;
  if (id === 'markets') return input.marketCount ?? undefined;
  return undefined;
}

/** The Settings sections for this member, with the keyword and market counts and the attention dots. */
export function settingsChildren(input: SettingsChildrenInput): NavChild[] {
  return SETTINGS_NAV
    .filter((entry) => input.isAdmin || !ADMIN_ONLY_SECTIONS.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      path: settingsPath(entry.id),
      label: entry.label,
      iconPaths: entry.iconPaths,
      iconColor: entry.iconColor,
      badge: settingsBadge(entry.id, input),
      needsAttention: input.attention.has(entry.id) || (entry.id === 'keywords' && input.keywordsCount === 0),
    }));
}
