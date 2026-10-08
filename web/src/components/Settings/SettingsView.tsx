import { useEffect } from 'react';
import {
  useLocation, useNavigate
} from 'react-router-dom';
import { KeywordsManager } from '../Keywords/KeywordsManager';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { BrandConfigContent } from '../Brands/BrandConfigContent';
import {
  countTrackedBrands, describeIndustry
} from '../Brands/brandConfigSummary';
import { AlertsConfig } from './AlertsConfig';
import { ProvidersConfig } from './ProvidersConfig';
import { UsersConfig } from './UsersConfig';
import { QueryPromptsManager } from './QueryPromptsManager';
import {
  SettingsNav, type SettingsNavGroup
} from './SettingsNav';
import {
  sectionFromPath, settingsPath, type SettingsTab
} from './settingsSections';
import type { Keyword } from '../../types';
import {
  CHAT_BUBBLES_PATHS, KEY_PATHS
} from '../ui/iconPaths';
import {
  SkeletonLines, SkeletonRegion 
} from '../ui/Skeleton';

export type { SettingsTab } from './settingsSections';

/** Where the "AI assistants" entry points: the connection guide page. */
export const AI_ASSISTANTS_PATH = '/ai-assistants';

interface SettingsViewProps {
  readonly keywords: Keyword[];
  readonly setKeywords: (keywords: Keyword[]) => void;
}

// Heroicons outline path per section (the svg wrapper is identical for all).
const SECTION_ICON_PATHS: Record<SettingsTab, readonly string[]> = {
  'keywords': KEY_PATHS,
  'brand-config': ['M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'],
  'query-prompts': ['M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'],
  'providers': ['M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'],
  'alerts': ['M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0'],
  'users': ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'],
};

interface SettingsNavInputs {
  readonly keywords: Keyword[];
  readonly brandConfig: Pick<ReturnType<typeof useBrandConfig>, 'config' | 'presets' | 'loading'>;
  readonly providerConfig: Pick<ReturnType<typeof useProviderConfig>, 'providers' | 'loading'>;
  readonly isAdmin: boolean;
}

function keywordCaption(count: number): string {
  if (count === 0) return 'No keywords yet';
  return count === 1 ? '1 keyword' : `${count} keywords`;
}

function sectionItem(id: SettingsTab, label: string, caption: string | null, needsAttention = false) {
  return {
    id,
    to: settingsPath(id),
    label,
    caption,
    iconPaths: SECTION_ICON_PATHS[id],
    needsAttention,
  };
}

/**
 * Single source of truth for the section list. Captions that depend on
 * loaded data are `null` until it arrives (the nav draws a placeholder), and
 * attention bubbles, which mark setup that blocks analysis runs, wait for
 * the data too so they never flash a false alarm.
 */
function buildSettingsNav({
  keywords, brandConfig, providerConfig, isAdmin
}: SettingsNavInputs): SettingsNavGroup[] {
  const {
    config, presets, loading: configLoading
  } = brandConfig;
  const {
    providers, loading: providersLoading
  } = providerConfig;
  const configuredCount = providers.filter((provider) => provider.configured).length;
  const enabledCount = providers.filter((provider) => provider.enabled && provider.configured).length;

  const access = [
    ...(isAdmin ? [sectionItem('users', 'Users', 'Invite people and set roles')] : []),
    {
      id: 'ai-assistants',
      to: AI_ASSISTANTS_PATH,
      label: 'AI assistants',
      caption: 'Connect Claude, ChatGPT, Kiro',
      iconPaths: CHAT_BUBBLES_PATHS,
    },
  ];

  return [
    {
      title: 'Tracking',
      items: [
        sectionItem('keywords', 'Keywords', keywordCaption(keywords.length), keywords.length === 0),
        sectionItem(
          'brand-config',
          'Brand tracking',
          configLoading ? null : describeIndustry(config, presets),
          !configLoading && countTrackedBrands(config, 'first_party') === 0,
        ),
        sectionItem('query-prompts', 'Personas', 'Audience rewrites of each keyword'),
      ],
    },
    {
      title: 'Answer engines',
      items: [
        sectionItem(
          'providers',
          'AI providers',
          providersLoading ? null : `${enabledCount} of ${providers.length} enabled`,
          !providersLoading && configuredCount === 0,
        ),
      ],
    },
    {
      title: 'Notifications',
      items: [sectionItem('alerts', 'Alerts', 'KPI changes by email')],
    },
    {
      title: 'Access',
      items: access,
    },
  ];
}

/** Placeholder for the Users section while admin membership is confirmed. */
const MembershipPending = () => (
  <SkeletonRegion label="Checking access" className="space-y-4">
    <SkeletonLines lines={2} className="max-w-md" />
  </SkeletonRegion>
);

interface SectionContentProps extends Pick<SettingsViewProps, 'keywords' | 'setKeywords'> {
  readonly section: SettingsTab;
  readonly brandConfig: ReturnType<typeof useBrandConfig>;
  readonly providerConfig: ReturnType<typeof useProviderConfig>;
  readonly isAdmin: boolean;
  readonly isAdminLoading: boolean;
}

function SectionContent({
  section, keywords, setKeywords, brandConfig, providerConfig, isAdmin, isAdminLoading
}: SectionContentProps) {
  switch (section) {
    case 'brand-config':
      return (
        <BrandConfigContent
          config={brandConfig.config}
          presets={brandConfig.presets}
          loading={brandConfig.loading}
          onSave={brandConfig.saveConfig}
          onExpandAllBrands={brandConfig.expandAllBrands}
          onFindCompetitors={brandConfig.findCompetitors}
        />
      );
    case 'query-prompts':
      return <QueryPromptsManager isAdmin={isAdmin} />;
    case 'providers':
      return (
        <ProvidersConfig
          providers={providerConfig.providers}
          loading={providerConfig.loading}
          onUpdate={providerConfig.updateProvider}
          onRefresh={providerConfig.refreshProviders}
          updateError={providerConfig.error}
          isAdmin={isAdmin}
        />
      );
    case 'alerts':
      return <AlertsConfig isAdmin={isAdmin} />;
    case 'users':
      if (isAdminLoading) return <MembershipPending />;
      return isAdmin ? <UsersConfig /> : null;
    default:
      return <KeywordsManager keywords={keywords} setKeywords={setKeywords} />;
  }
}

export const SettingsView = ({
  keywords, setKeywords
}: SettingsViewProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);
  const brandConfig = useBrandConfig();
  const providerConfig = useProviderConfig();
  // User management is Admin-only server-side; this only hides the entry point
  // so non-admins aren't shown a section where every action returns 403.
  const {
    isAdmin, loading: isAdminLoading
  } = useIsAdmin();

  // A link or bookmark can land a non-admin on the Users section: send them
  // to Keywords once membership is known instead of showing an empty panel.
  useEffect(() => {
    if (!isAdminLoading && !isAdmin && section === 'users') {
      navigate(settingsPath('keywords'), { replace: true });
    }
  }, [isAdmin, isAdminLoading, section, navigate]);

  const groups = buildSettingsNav({
    keywords,
    brandConfig,
    providerConfig,
    isAdmin
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)] gap-4 md:gap-6 items-start">
        <SettingsNav groups={groups} activeId={section} />
        {/* A floor height keeps the footer from jumping while a section loads. */}
        <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 min-h-[28rem]">
          <SectionContent
            section={section}
            keywords={keywords}
            setKeywords={setKeywords}
            brandConfig={brandConfig}
            providerConfig={providerConfig}
            isAdmin={isAdmin}
            isAdminLoading={isAdminLoading}
          />
        </section>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Version {import.meta.env.VITE_APP_VERSION ?? 'dev'}
      </p>
    </div>
  );
};
