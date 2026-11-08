/**
 * A short note that an SEO page needs a value it reads from Settings, with a link to the exact section,
 * shown instead of asking for the value again (the SEO pages are configured in Settings).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  settingsPath, type SettingsTab
} from '../Settings/settingsSections';

const SECTION_LABELS: Partial<Record<SettingsTab, string>> = {
  'brand-config': 'Settings › Brand Tracking',
  'keywords': 'Settings › Keywords',
  'markets': 'Settings › Markets',
};

export function SettingsHint({
  section, children
}: {
  readonly section: 'brand-config' | 'keywords' | 'markets';
  readonly children: ReactNode;
}) {
  return (
    <p className="text-sm text-gray-600 dark:text-gray-300">
      {children}{' '}
      <Link to={settingsPath(section)} className="font-medium text-gray-900 underline hover:text-gray-700 dark:text-gray-50 dark:hover:text-gray-300">
        {`Open ${SECTION_LABELS[section] ?? 'Settings'}`}
      </Link>
    </p>
  );
}
