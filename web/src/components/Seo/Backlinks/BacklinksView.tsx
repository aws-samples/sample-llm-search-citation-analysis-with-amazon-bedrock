/**
 * Backlinks: who links to a domain, subfolder or page, what changed recently,
 * and how your domains' authority compares with your competitors' over time.
 *
 * The page starts from Settings › Brand Tracking: an empty input means the
 * brand's own domain; quick picks are its own and competitors' domains plus
 * any other tracked snapshot domain.
 *
 * Every DataForSEO lookup (overview, a table page, an expanded domain) runs
 * only on an explicit action (Search, a quick pick, a tab, page, sort,
 * filter, spam or link-mode change): nothing paid is fetched on mount, focus
 * or retry. The snapshot chart is a free read of stored data.
 */
import {
  useMemo, useState
} from 'react';
import { isSeoApiConfigured } from '../../../api/seo';
import { useBacklinkSnapshots } from '../../../hooks/useBacklinkSnapshots';
import { useBacklinksOverview } from '../../../hooks/useBacklinksOverview';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import type { BacklinksTargetRequest } from '../../../types/api/seoBacklinks';
import { NOT_SET_UP_TITLE } from '../../KeywordResearch/explorer/KeywordExplorer';
import { CenteredEmpty } from '../../ui/CenteredState';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { LinkIcon } from '../../ui/Icons';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import {
  Skeleton, SkeletonCards, SkeletonRegion
} from '../../ui/Skeleton';
import { BacklinkSnapshotsPanel } from './BacklinkSnapshotsPanel';
import { BacklinksOverviewPanel } from './BacklinksOverviewPanel';
import { BacklinksResults } from './BacklinksResults';
import { BacklinksSearchCard } from './BacklinksSearchCard';
import {
  mergeDomainPicks, useSettingsDomains
} from '../settingsDomains';

const SET_UP_STEPS = [
  'Deployment: deploy the SEO stack (CitationAnalysisSeoStack) and rebuild the dashboard.',
  'Admin: add the DataForSEO login in Settings › AI Providers.',
] as const;

/** Shown when the dashboard was built without the SEO stack's API URL. */
function BacklinksNotSetUp() {
  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-6" aria-labelledby="backlinks-not-set-up">
      <h3 id="backlinks-not-set-up" className="text-base font-semibold text-gray-900">{NOT_SET_UP_TITLE}</h3>
      <p className="text-sm text-gray-600">Backlinks are read from DataForSEO through the SEO stack. To turn them on:</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
        {SET_UP_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </section>
  );
}

function ConfiguredBacklinks() {
  const overview = useBacklinksOverview();
  const snapshots = useBacklinkSnapshots(true);
  const { isAdmin } = useIsAdmin();
  const [target, setTarget] = useState<BacklinksTargetRequest | null>(null);
  const { state } = overview;
  const settingsDomains = useSettingsDomains();
  const trackedDomains = snapshots.data?.domains;
  const domains = useMemo(() => ({
    ...settingsDomains,
    picks: mergeDomainPicks(settingsDomains.picks, trackedDomains ?? []),
  }), [settingsDomains, trackedDomains]);

  const search = (request: BacklinksTargetRequest) => {
    setTarget(request);
    void overview.run(request);
  };

  return (
    <div className="space-y-4">
      <PageHeaderCard title="Backlinks" relaxed={false}
        description="Who links to a site, what changed recently, and which pages attract links.">
        <BacklinksSearchCard searching={state.status === 'loading'} domains={domains} onSearch={search} />
      </PageHeaderCard>
      {state.status === 'idle' && (
        <CenteredEmpty
          icon={<LinkIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />}
          title={domains.ownDomain === null ? 'Enter a domain or URL to get started' : `Analyze ${domains.ownDomain} or enter another domain`}
          hint="See its authority, backlinks, referring domains and top pages, or pick one of your or your competitors' domains."
        />
      )}
      {state.status === 'loading' && (
        <SkeletonRegion label="Loading backlinks overview" className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 space-y-4">
          <Skeleton className="h-6 w-56" />
          <SkeletonCards count={12} gridClassName="grid-cols-2 sm:grid-cols-4" cardClassName="h-24" />
        </SkeletonRegion>
      )}
      {state.status === 'error' && <ErrorAlert message={state.message} />}
      {state.status === 'success' && target !== null && (
        <>
          <BacklinksOverviewPanel overview={state.response} />
          <BacklinksResults key={`${state.response.api_target}|${state.response.scope}`} target={target} scope={state.response.scope} />
        </>
      )}
      <BacklinkSnapshotsPanel snapshots={snapshots} isAdmin={isAdmin} />
    </div>
  );
}

export function BacklinksView() {
  if (!isSeoApiConfigured()) return <BacklinksNotSetUp />;
  return <ConfiguredBacklinks />;
}
