/**
 * Settings sections and their URLs. Each section has its own path under
 * `/settings/` so it can be linked to, bookmarked and reached with the
 * browser's back button; `/settings` alone opens Keywords.
 */
import {
  CHAT_BUBBLES_PATHS, GLOBE_PATHS, KEY_PATHS
} from '../ui/iconPaths';

export type SettingsTab =
  | 'keywords'
  | 'markets'
  | 'brand-config'
  | 'query-prompts'
  | 'providers'
  | 'alerts'
  | 'users'
  | 'bedrock-models'
  | 'ai-assistants';

export const SETTINGS_BASE_PATH = '/settings';

const SECTION_SLUGS: Record<SettingsTab, string> = {
  'keywords': 'keywords',
  'markets': 'markets',
  'brand-config': 'brand',
  'query-prompts': 'personas',
  'providers': 'providers',
  'alerts': 'alerts',
  'users': 'users',
  'bedrock-models': 'bedrock-models',
  'ai-assistants': 'ai-assistants',
};

const SECTIONS: readonly SettingsTab[] = ['keywords', 'markets', 'brand-config', 'query-prompts', 'providers', 'alerts', 'users', 'bedrock-models', 'ai-assistants'];

/** Sections only administrators open; the server refuses everyone else. */
export const ADMIN_ONLY_SECTIONS: ReadonlySet<SettingsTab> = new Set(['users', 'bedrock-models']);

/** One Settings section as the sidebar lists it. */
export interface SettingsNavEntry {
  readonly id: SettingsTab;
  readonly label: string;
  readonly iconPaths: readonly string[];
  /** Tailwind text colour of the icon, from the design-system accent palette (docs/design-system.md §2.2). */
  readonly iconColor: string;
}

/**
 * The sections in sidebar order: tracking setup, answer engines, processing, notifications, access. Brand
 * tracking shares Brand Mentions' violet, personas Prompt Insights' fuchsia, alerts the warning amber.
 */
export const SETTINGS_NAV: readonly SettingsNavEntry[] = [
  {
    id: 'keywords',
    label: 'Keywords',
    iconPaths: KEY_PATHS,
    iconColor: 'text-blue-500',
  },
  {
    id: 'markets',
    label: 'Markets',
    iconPaths: GLOBE_PATHS,
    iconColor: 'text-cyan-500',
  },
  {
    id: 'brand-config',
    label: 'Brand tracking',
    iconPaths: ['M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'],
    iconColor: 'text-violet-500',
  },
  {
    id: 'query-prompts',
    label: 'Personas',
    iconPaths: ['M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'],
    iconColor: 'text-fuchsia-500',
  },
  {
    id: 'providers',
    label: 'AI providers',
    iconPaths: ['M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'],
    iconColor: 'text-sky-500',
  },
  {
    id: 'bedrock-models',
    label: 'Bedrock models',
    iconPaths: ['M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z'],
    iconColor: 'text-teal-500',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    iconPaths: ['M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0'],
    iconColor: 'text-amber-500',
  },
  {
    id: 'users',
    label: 'Users',
    iconPaths: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'],
    iconColor: 'text-emerald-500',
  },
  {
    id: 'ai-assistants',
    label: 'AI assistants',
    iconPaths: CHAT_BUBBLES_PATHS,
    iconColor: 'text-indigo-500',
  },
];

const SLUG_TO_SECTION: ReadonlyMap<string, SettingsTab> = new Map(
  SECTIONS.map((section) => [SECTION_SLUGS[section], section])
);

/** The URL of one settings section, e.g. `/settings/brand`. */
export function settingsPath(section: SettingsTab): string {
  return `${SETTINGS_BASE_PATH}/${SECTION_SLUGS[section]}`;
}

/** Whether a pathname belongs to the Settings page (any section). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_BASE_PATH || pathname.startsWith(`${SETTINGS_BASE_PATH}/`);
}

/** The section a pathname opens: Keywords for `/settings` or an unknown slug. */
export function sectionFromPath(pathname: string): SettingsTab {
  const slug = pathname.slice(SETTINGS_BASE_PATH.length + 1).split('/')[0] ?? '';
  return SLUG_TO_SECTION.get(slug) ?? 'keywords';
}
