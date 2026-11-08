/**
 * Local SEO: Google business listings, Business Profiles (reviews, updates, Q&A), Maps / Local Finder
 * results and the local rank grid, for the market chosen in the header.
 *
 * Every paid DataForSEO call runs on a click only (never on mount, focus or retry); the rank grid asks for
 * confirmation with its paid call count first. The forms start from Settings: points from the header market's
 * city coordinates, the business from the brand's name (Brand Tracking; "your business" in results is matched by
 * the brand's own domain) and keyword fields suggest the header market's keywords.
 */
import { useState } from 'react';
import { isSeoApiConfigured } from '../../../api/seo';
import { useLocalSeoMarket } from '../../../hooks/useLocalSeoMarket';
import { useLocalSeoProfile } from '../../../hooks/useLocalSeoProfile';
import type { BusinessListing } from '../../../types/api/seoLocal';
import {
  TabBar, type TabDefinition
} from '../../ui/TabBar';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import { NOT_SET_UP_TITLE } from '../../KeywordResearch/explorer/KeywordExplorer';
import { BusinessProfileTab } from './BusinessProfileTab';
import { BusinessSearchTab } from './BusinessSearchTab';
import { LocalResultsTab } from './LocalResultsTab';
import { identityOf } from './localSeoRequest';
import { useLocalSeoSettings } from './localSeoSettings';
import { RankGridTab } from './RankGridTab';

type LocalTab = 'search' | 'profile' | 'results' | 'grid';

const TABS: readonly TabDefinition<LocalTab>[] = [
  {
    id: 'search',
    label: 'Business search' 
  },
  {
    id: 'profile',
    label: 'Business profile' 
  },
  {
    id: 'results',
    label: 'Local results' 
  },
  {
    id: 'grid',
    label: 'Local rank grid' 
  },
];

function LocalSeoNotSetUp() {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-6" aria-labelledby="local-seo-setup">
      <h3 id="local-seo-setup" className="text-base font-semibold text-gray-900">{NOT_SET_UP_TITLE}</h3>
      <p className="mt-2 text-sm text-gray-600">
        Local SEO reads business listings, profiles and Maps results from DataForSEO. Deploy the SEO stack
        (<code>CitationAnalysisSeoStack</code>) and rebuild the dashboard; then an Admin adds the DataForSEO login in
        Settings › AI Providers.
      </p>
    </section>
  );
}

function ConfiguredLocalSeo() {
  const market = useLocalSeoMarket();
  const settings = useLocalSeoSettings();
  const profile = useLocalSeoProfile(settings.brandName);
  const [tab, setTab] = useState<LocalTab>('search');

  const openBusiness = (business: BusinessListing) => {
    profile.load(identityOf(business), market.marketField);
    setTab('profile');
  };

  return (
    <div className="space-y-4">
      <PageHeaderCard title="Local SEO" relaxed={false}
        description="Google business listings and profiles, Maps results and a local rank grid around the header market's city." />
      <TabBar tabs={TABS} activeId={tab} onChange={setTab} label="Local SEO" />
      {tab === 'search' && <BusinessSearchTab settings={settings} onOpenBusiness={openBusiness} />}
      {tab === 'profile' && <BusinessProfileTab profile={profile} market={market} settings={settings} />}
      {tab === 'results' && <LocalResultsTab market={market} settings={settings} />}
      {tab === 'grid' && <RankGridTab market={market} settings={settings} />}
    </div>
  );
}

export function LocalSeoView() {
  if (!isSeoApiConfigured()) return <LocalSeoNotSetUp />;
  return <ConfiguredLocalSeo />;
}
