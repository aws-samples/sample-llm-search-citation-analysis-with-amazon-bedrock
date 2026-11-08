/**
 * Domain Overview: what any domain ranks for on Google in the header market
 * (DataForSEO Labs): its organic keywords, estimated traffic and its value,
 * the ranked keywords, top pages and SERP competitors.
 *
 * The page starts from Settings › Brand Tracking: an empty input means the
 * brand's own domain, and its own and competitors' domains are quick picks.
 *
 * Every DataForSEO call is a click: Analyze (overview + first keyword page),
 * a page, a sort, Apply, "Load top pages", "Find SERP competitors". Nothing
 * is fetched on mount, focus or retry. Labs does not cover Google-Ads-only
 * countries: the API refuses them before any charge and the error says so.
 */
import {
  useEffect, useId, useState
} from 'react';
import { isSeoApiConfigured } from '../../../api/seo';
import { useDomainOverview } from '../../../hooks/useDomainOverview';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import type {
  DomainScope, DomainTargetRequest
} from '../../../types/api/seoDomains';
import { useMarketSelection } from '../../Markets/marketSelectionContext';
import {
  TabBar, TabPanel
} from '../../ui/TabBar';
import {
  Skeleton, SkeletonCards, SkeletonRegion
} from '../../ui/Skeleton';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import { SearchIcon } from '../../ui/Icons';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { CenteredEmpty } from '../../ui/CenteredState';
import { DomainCompetitorsPanel } from './DomainCompetitorsPanel';
import {
  DomainKeywordsPanel, firstKeywordsRequest
} from './DomainKeywordsPanel';
import { DomainOverviewSummary } from './DomainOverviewSummary';
import { DomainPagesPanel } from './DomainPagesPanel';
import { DomainSearchForm } from './DomainSearchForm';
import { DomainSnapshotButton } from './DomainSnapshotButton';
import { DomainSnapshotHistory } from './DomainSnapshotHistory';
import { useSettingsDomains } from '../settingsDomains';

export const NOT_SET_UP_TITLE = 'SEO data is not set up';

type TabId = 'keywords' | 'pages' | 'competitors';

const TABS: ReadonlyArray<{
  readonly id: TabId;
  readonly label: string;
}> = [
  {
    id: 'keywords',
    label: 'Top keywords',
  },
  {
    id: 'pages',
    label: 'Top pages',
  },
  {
    id: 'competitors',
    label: 'SERP competitors',
  },
];

interface Analysis {
  readonly id: number;
  readonly target: DomainTargetRequest;
}

const NOT_SET_UP_TEXT = 'The Domain Overview reads organic rankings and estimated traffic from DataForSEO through the SEO stack. '
  + 'Deploy the SEO stack, rebuild the dashboard, and add the DataForSEO login in Settings › AI Providers.';

const CARD_CLASS = 'bg-white rounded-lg border border-gray-200 p-4 sm:p-6';

/** Shown when the dashboard was built without the SEO stack's API URL. */
const NotSetUp = () => (
  <section aria-labelledby="domain-overview-not-set-up" className={CARD_CLASS}>
    <h3 id="domain-overview-not-set-up" className="text-base font-semibold text-gray-900 mb-2">{NOT_SET_UP_TITLE}</h3>
    <p className="text-sm text-gray-600">{NOT_SET_UP_TEXT}</p>
  </section>
);

/** The overview card while it loads: the heading, three stat tiles and the position strip. */
const OverviewSkeleton = () => (
  <SkeletonRegion label="Loading domain overview" className={`${CARD_CLASS} space-y-4`}>
    <Skeleton className="h-6 w-56" />
    <SkeletonCards count={3} gridClassName="grid-cols-1 sm:grid-cols-3" cardClassName="h-24" />
    <Skeleton className="h-2 w-full rounded-full" />
    <Skeleton className="h-14 w-full rounded-lg" />
  </SkeletonRegion>
);

function ConfiguredDomainOverview() {
  const { selectedMarketId } = useMarketSelection();
  const { isAdmin } = useIsAdmin();
  const requests = useDomainOverview();
  const domains = useSettingsDomains();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [tab, setTab] = useState<TabId>('keywords');
  const panelId = useId();
  const {
    overview, keywords, pages, competitors
  } = requests;
  const {reset: resetOverview} = overview;
  const {reset: resetKeywords} = keywords;
  const {reset: resetPages} = pages;
  const {reset: resetCompetitors} = competitors;

  // Another market's results must not be read as this one's.
  useEffect(() => {
    resetOverview();
    resetKeywords();
    resetPages();
    resetCompetitors();
    setAnalysis(null);
  }, [selectedMarketId, resetOverview, resetKeywords, resetPages, resetCompetitors]);

  const analyze = (target: string, scope: DomainScope | undefined) => {
    const request: DomainTargetRequest = {
      target,
      ...(scope === undefined ? {} : { scope }),
      ...(selectedMarketId === null ? {} : { market_id: selectedMarketId }),
    };
    pages.reset();
    competitors.reset();
    setTab('keywords');
    setAnalysis((current) => ({
      id: (current?.id ?? 0) + 1,
      target: request,
    }));
    void overview.run(request);
    void keywords.run(firstKeywordsRequest(request));
  };

  const overviewState = overview.state;
  const resolvedScope: DomainScope = overviewState.status === 'success' ? overviewState.response.scope : 'subdomains';
  const shownKeywords = keywords.state.status === 'success' ? keywords.state.response.items.map((row) => row.keyword) : [];

  return (
    <div className="space-y-4">
      <PageHeaderCard title="Domain Overview" relaxed={false}
        description="What a domain ranks for on Google in the header market: organic keywords, estimated traffic and its value, top pages and SERP competitors.">
        <DomainSearchForm busy={overviewState.status === 'loading'} domains={domains} onAnalyze={analyze} />
      </PageHeaderCard>
      {analysis === null && (
        <CenteredEmpty
          icon={<SearchIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />}
          title={domains.ownDomain === null ? 'Enter a domain to get started' : `Analyze ${domains.ownDomain} or enter another domain`}
          hint="See the domain's organic keywords, estimated traffic, top pages and SERP competitors in the header market."
        />
      )}
      {overviewState.status === 'loading' && <OverviewSkeleton />}
      {overviewState.status === 'error' && <ErrorAlert message={overviewState.message} />}
      {overviewState.status === 'success' && (
        <section className={CARD_CLASS}>
          <DomainOverviewSummary overview={overviewState.response} />
          <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
            {isAdmin && <DomainSnapshotButton domain={overviewState.response.hostname} marketId={overviewState.response.market_id} />}
            <DomainSnapshotHistory key={overviewState.response.hostname} domain={overviewState.response.hostname}
              marketId={overviewState.response.market_id} />
          </div>
        </section>
      )}
      {analysis !== null && (
        <section className="bg-white rounded-lg border border-gray-200">
          <TabBar tabs={TABS} activeId={tab} onChange={setTab} label="Domain research" panelId={panelId} className="px-4 sm:px-6" />
          <TabPanel id={panelId} activeId={tab} className="p-4 sm:p-6">
            <div hidden={tab !== 'keywords'}>
              <DomainKeywordsPanel key={analysis.id} target={analysis.target} scope={resolvedScope} request={keywords} />
            </div>
            <div hidden={tab !== 'pages'}>
              <DomainPagesPanel key={analysis.id} target={analysis.target} scope={resolvedScope} request={pages} />
            </div>
            <div hidden={tab !== 'competitors'}>
              <DomainCompetitorsPanel keywords={shownKeywords} marketId={analysis.target.market_id}
                scopeLabel={analysis.target.target} request={competitors} />
            </div>
          </TabPanel>
        </section>
      )}
    </div>
  );
}

export function DomainOverviewView() {
  if (!isSeoApiConfigured()) return <NotSetUp />;
  return <ConfiguredDomainOverview />;
}
