import {
  useEffect, useState 
} from 'react';
import type { ReactNode } from 'react';
import { KeywordsManager } from '../Keywords/KeywordsManager';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import {useProviderConfig} from '../../hooks/useProviderConfig';
import { BrandConfigContent } from '../Brands/BrandConfigContent';
import { ProvidersConfig } from './ProvidersConfig';
import { UsersConfig } from './UsersConfig';
import { QueryPromptsManager } from './QueryPromptsManager';
import type { Keyword } from '../../types';

interface SettingsViewProps {
  keywords: Keyword[];
  setKeywords: (keywords: Keyword[]) => void;
  /** Tab to open on mount (e.g. deep links from the onboarding checklist). */
  initialTab?: SettingsTab;
}

export type SettingsTab = 'keywords' | 'brand-config' | 'query-prompts' | 'providers' | 'users';

function getProviderBadgeClass(enabledCount: number, configuredCount: number): string {
  if (enabledCount === configuredCount && configuredCount > 0) {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (configuredCount > 0) {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-gray-100 text-gray-600';
}

/** Notification bubble shown on tabs whose configuration blocks analysis runs. */
const AttentionDot = () => (
  <output
    aria-label="Needs configuration"
    className="ml-1 inline-block w-2 h-2 rounded-full bg-amber-500"
  />
);

// Heroicons outline path per tab (the svg wrapper is identical for all).
const TAB_ICON_PATHS: Record<SettingsTab, string> = {
  'keywords': 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z',
  'brand-config': 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  'query-prompts': 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
  'providers': 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
  'users': 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
};

interface SettingsTabDefinition {
  id: SettingsTab;
  label: string;
  /** Count/status bubble rendered after the label, when the tab has one. */
  badge?: ReactNode;
  needsAttention?: boolean;
}

export const SettingsView = ({
  keywords, setKeywords, initialTab 
}: SettingsViewProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'keywords');
  const {
    config, presets, loading: configLoading, saveConfig, expandAllBrands, findCompetitors 
  } = useBrandConfig();
  const {
    providers, loading: providersLoading, updateProvider, refreshProviders 
  } = useProviderConfig();
  // User management is Admin-only server-side; this only hides the entry point
  // so non-admins aren't shown a tab where every action returns 403.
  const {
    isAdmin, loading: isAdminLoading 
  } = useIsAdmin();

  // `initialTab` is typed as the full SettingsTab union, so a deep link can
  // land a non-admin on the hidden tab — which would render a tab bar with
  // nothing selected and an empty content panel.
  useEffect(() => {
    if (!isAdminLoading && !isAdmin && activeTab === 'users') {
      setActiveTab('keywords');
    }
  }, [isAdmin, isAdminLoading, activeTab]);

  const industryName = config?.industry
    ? presets?.[config.industry]?.name ?? config.industry
    : 'Not configured';
  
  const configuredCount = providers.filter(p => p.configured).length;
  const enabledCount = providers.filter(p => p.enabled && p.configured).length;

  // Attention bubbles for setup that blocks analysis runs; suppressed while
  // the underlying data is still loading to avoid flashing false alarms.
  const keywordsNeedAttention = keywords.length === 0;
  const brandNeedsAttention = !configLoading && (config?.tracked_brands.first_party.length ?? 0) === 0;
  const providersNeedAttention = !providersLoading && configuredCount === 0;

  // Single source of truth for the tab bar (bugs.md §5): the button markup
  // below renders once from this list instead of five hand-written copies.
  const tabs: SettingsTabDefinition[] = [
    {
      id: 'keywords',
      label: 'Keywords',
      badge: (
        <span className="ml-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
          {keywords.length}
        </span>
      ),
      needsAttention: keywordsNeedAttention,
    },
    {
      id: 'brand-config',
      label: 'Brand Tracking',
      badge: (
        <span className="hidden lg:inline ml-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
          {industryName}
        </span>
      ),
      needsAttention: brandNeedsAttention,
    },
    {
      id: 'query-prompts',
      label: 'Personas',
    },
    {
      id: 'providers',
      label: 'AI Providers',
      badge: (
        <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${getProviderBadgeClass(enabledCount, configuredCount)}`}>
          {enabledCount}/{providers.length}
        </span>
      ),
      needsAttention: providersNeedAttention,
    },
    // Withheld until membership is confirmed, so the tab doesn't flash in for
    // non-admins on the first paint.
    ...(isAdmin ? [{
      id: 'users' as const,
      label: 'Users',
    }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 sm:px-6 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={TAB_ICON_PATHS[tab.id]} />
                  </svg>
                  <span className="sr-only sm:not-sr-only">{tab.label}</span>
                  {tab.badge}
                  {tab.needsAttention && <AttentionDot />}
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6">
          {activeTab === 'keywords' && (
            <KeywordsManager keywords={keywords} setKeywords={setKeywords} />
          )}

          {activeTab === 'brand-config' && (
            <BrandConfigContent
              config={config}
              presets={presets}
              loading={configLoading}
              onSave={saveConfig}
              onExpandAllBrands={expandAllBrands}
              onFindCompetitors={findCompetitors}
            />
          )}

          {activeTab === 'query-prompts' && (
            <QueryPromptsManager isAdmin={isAdmin} />
          )}

          {activeTab === 'providers' && (
            <ProvidersConfig
              providers={providers}
              loading={providersLoading}
              onUpdate={updateProvider}
              onRefresh={refreshProviders}
              isAdmin={isAdmin}
            />
          )}

          {activeTab === 'users' && isAdmin && (
            <UsersConfig />
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Version {import.meta.env.VITE_APP_VERSION ?? 'dev'}
      </p>
    </div>
  );
};
