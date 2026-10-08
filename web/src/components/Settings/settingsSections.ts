/**
 * Settings sections and their URLs. Each section has its own path under
 * `/settings/` so it can be linked to, bookmarked and reached with the
 * browser's back button; `/settings` alone opens Keywords.
 */
export type SettingsTab =
  | 'keywords'
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
  'brand-config': 'brand',
  'query-prompts': 'personas',
  'providers': 'providers',
  'alerts': 'alerts',
  'users': 'users',
  'bedrock-models': 'bedrock-models',
  'ai-assistants': 'ai-assistants',
};

const SECTIONS: readonly SettingsTab[] = ['keywords', 'brand-config', 'query-prompts', 'providers', 'alerts', 'users', 'bedrock-models', 'ai-assistants'];

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
