import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isSeoApiConfigured } from '../../api/seo';
import { SEO_GEO_QUADRANTS } from '../../constants/seoGeoDefinitions';
import { useSeoGeo } from '../../hooks/useSeoGeo';
import { useSeoRequest } from '../../hooks/useSeoGeoRequest';
import { useSelectedMarketId } from '../Markets/marketSelectionContext';
import {
  Skeleton, SkeletonRegion
} from '../ui/Skeleton';
import {
  loadRankingsSummary, type RankingsSummary
} from './rankingsSummary';

const CARD = 'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-3';
const LINK = 'text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-500 rounded-sm';

interface SeoCardProps {
  readonly title: string;
  readonly linkTo: string;
  readonly linkLabel: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly children: ReactNode;
}

function SeoCard({
  title, linkTo, linkLabel, loading, error, children
}: SeoCardProps) {
  return (
    <section aria-label={title} className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">{title}</h3>
        <Link to={linkTo} className={LINK}>{linkLabel}</Link>
      </div>
      {loading && (
        <SkeletonRegion label={`Loading ${title}`}>
          <Skeleton className="h-12 w-full" />
        </SkeletonRegion>
      )}
      {!loading && error !== null && <p className="text-sm text-gray-500">Unavailable: {error}</p>}
      {!loading && error === null && children}
    </section>
  );
}

function Figure({
  label, value
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-xl font-semibold text-gray-900 dark:text-white">{value}</dd>
    </div>
  );
}

/** Quadrant counts of `GET /api/seo/seo-geo` for the header market (no DataForSEO call). */
function SeoGeoCard() {
  const state = useSeoGeo(null);
  const summary = state.data?.summary;
  return (
    <SeoCard title="SEO vs GEO" linkTo="/reports/seo-geo" linkLabel="Open report" loading={state.loading} error={state.error}>
      {summary !== undefined && (
        <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {SEO_GEO_QUADRANTS.map((quadrant) => <Figure key={quadrant.id} label={quadrant.label} value={summary[quadrant.id]} />)}
        </dl>
      )}
    </SeoCard>
  );
}

function RankingsBody({ summary }: { readonly summary: RankingsSummary }) {
  if (summary.trackers === 0) return <p className="text-sm text-gray-500">No rank tracker in this market yet.</p>;
  if (summary.checkedTrackers === 0) return <p className="text-sm text-gray-500">No ranking check in the last month yet.</p>;
  return (
    <dl className="grid grid-cols-3 gap-3">
      <Figure label="Top 3" value={summary.top3} />
      <Figure label="Top 10" value={summary.top10} />
      <Figure label="Tracked keywords" value={summary.keywords} />
    </dl>
  );
}

/** Tracked keywords in Google's top 3 and top 10 at each tracker's newest check (free reads only). */
function RankingsCard() {
  const marketId = useSelectedMarketId();
  const state = useSeoRequest(true, marketId ?? '', () => loadRankingsSummary(marketId));
  return (
    <SeoCard title="Rankings" linkTo="/seo/rank-tracking" linkLabel="Open Rank Tracking" loading={state.loading} error={state.error}>
      {state.data !== null && <RankingsBody summary={state.data} />}
    </SeoCard>
  );
}

/** The two SEO cards of the dashboard; nothing when the SEO stack is not deployed. */
export function SeoDashboardCards() {
  if (!isSeoApiConfigured()) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
      <SeoGeoCard />
      <RankingsCard />
    </div>
  );
}
