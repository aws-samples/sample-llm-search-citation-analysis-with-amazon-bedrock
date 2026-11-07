import {
  useEffect, type ReactNode
} from 'react';
import {
  useLocation, useNavigate
} from 'react-router-dom';
import { KeywordsManager } from '../Keywords/KeywordsManager';
import { useBrandConfig } from '../../hooks/useBrandConfig';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useProviderConfig } from '../../hooks/useProviderConfig';
import { BrandConfigContent } from '../Brands/BrandConfigContent';
import { countTrackedBrands } from '../Brands/brandConfigSummary';
import { usePublishSettingsAttention } from '../Layout/settingsAttention';
import { AlertsConfig } from './AlertsConfig';
import { MarketsConfig } from './MarketsConfig';
import { ProvidersConfig } from './ProvidersConfig';
import { UsersConfig } from './UsersConfig';
import { BedrockModelsConfig } from './BedrockModelsConfig';
import { QueryPromptsManager } from './QueryPromptsManager';
import { AiAssistantsView } from '../AiAssistants';
import {
  ADMIN_ONLY_SECTIONS, sectionFromPath, settingsPath, type SettingsTab
} from './settingsSections';
import type { Keyword } from '../../types';
import {
  SkeletonLines, SkeletonRegion 
} from '../ui/Skeleton';

export type { SettingsTab } from './settingsSections';

interface SettingsViewProps {
  readonly keywords: Keyword[];
  readonly setKeywords: (keywords: Keyword[]) => void;
}

/** The sections whose setup blocks analysis runs, once their data has loaded (never a false alarm while loading). */
function sectionsNeedingSetup(
  brandConfig: Pick<ReturnType<typeof useBrandConfig>, 'config' | 'loading'>,
  providerConfig: Pick<ReturnType<typeof useProviderConfig>, 'providers' | 'loading'>,
): SettingsTab[] {
  const brandMissing = !brandConfig.loading && countTrackedBrands(brandConfig.config, 'first_party') === 0;
  const providersMissing = !providerConfig.loading && !providerConfig.providers.some((provider) => provider.configured);
  return [...(brandMissing ? ['brand-config' as const] : []), ...(providersMissing ? ['providers' as const] : [])];
}

/** Placeholder for an admin-only section while admin membership is confirmed. */
const MembershipPending = () => (
  <SkeletonRegion label="Checking access" className="space-y-4">
    <SkeletonLines lines={2} className="max-w-md" />
  </SkeletonRegion>
);

interface AdminOnlyProps {
  readonly isAdmin: boolean;
  readonly isAdminLoading: boolean;
  readonly children: ReactNode;
}

/** An admin-only section: a placeholder while membership loads, nothing for non-admins. */
const AdminOnly = ({
  isAdmin, isAdminLoading, children
}: AdminOnlyProps) => {
  if (isAdminLoading) return <MembershipPending />;
  return isAdmin ? <>{children}</> : null;
};

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
    case 'markets':
      return <MarketsConfig isAdmin={isAdmin} />;
    case 'users':
      return <AdminOnly isAdmin={isAdmin} isAdminLoading={isAdminLoading}><UsersConfig /></AdminOnly>;
    case 'bedrock-models':
      return <AdminOnly isAdmin={isAdmin} isAdminLoading={isAdminLoading}><BedrockModelsConfig /></AdminOnly>;
    case 'ai-assistants':
      return <AiAssistantsView />;
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

  // A link or bookmark can land a non-admin on an admin-only section: send
  // them to Keywords once membership is known instead of showing an empty panel.
  useEffect(() => {
    if (!isAdminLoading && !isAdmin && ADMIN_ONLY_SECTIONS.has(section)) {
      navigate(settingsPath('keywords'), { replace: true });
    }
  }, [isAdmin, isAdminLoading, section, navigate]);

  usePublishSettingsAttention(sectionsNeedingSetup(brandConfig, providerConfig));

  return (
    <div className="space-y-6">
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

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Version {import.meta.env.VITE_APP_VERSION ?? 'dev'}
      </p>
    </div>
  );
};
