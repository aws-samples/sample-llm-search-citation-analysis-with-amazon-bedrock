/**
 * Rank Tracking: where tracked domains rank in Google for their keywords, per device, over time.
 *
 * The tracker list is filtered to the header market (every tracker when every market is combined); a new
 * tracker is created in the header market, for a domain of Settings › Brand Tracking, on the Settings keywords
 * of the market (or of one keyword group). While the market has none, Admins get the one-click "Track your
 * rankings" card. Admins create, edit, archive and run trackers; everyone reads.
 * Nothing paid happens on mount, focus or retry: a check runs on schedule or on a confirmed click.
 * `?tracker=<id>` (the Schedule page's links) opens on that tracker.
 */
import {
  useMemo, useState
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  competitorDomainEntries, type CompetitorDomain
} from '../../../api/brandSettings';
import { archiveRankTracker } from '../../../api/seoRankTracking';
import {
  isSeoApiConfigured, seoErrorMessage
} from '../../../api/seo';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { useRankTrackerList } from '../../../hooks/useRankTrackingData';
import type {
  RankTracker, RankTrackerList
} from '../../../types/api/seoRankTracking';
import { GLOBAL_MARKET_ID } from '../../../types';
import { marketName } from '../../Markets/marketSelection';
import { useMarketSelection } from '../../Markets/marketSelectionContext';
import { Button } from '../../ui/Button';
import { CenteredEmpty } from '../../ui/CenteredState';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { ConfirmModal } from '../../ui/Modal';
import { PageHeaderCard } from '../../ui/PageHeaderCard';
import {
  SkeletonCards, SkeletonRegion
} from '../../ui/Skeleton';
import { CompetitorTrackersModal } from './CompetitorTrackersModal';
import {
  TrackRankingsCard, type TrackRankingsCardProps
} from './TrackRankingsCard';
import { TrackerDetail } from './TrackerDetail';
import { TrackerFormModal } from './TrackerFormModal';
import {
  SCHEDULE_LABELS, keywordScopeLabel
} from './rankTrackingFormat';

export const RANK_NOT_SET_UP_TITLE = 'SEO data is not set up';

function RankTrackingNotSetUp() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-2">
      <h3 className="text-base font-semibold text-gray-900">{RANK_NOT_SET_UP_TITLE}</h3>
      <p className="text-sm text-gray-600">
        Rank tracking checks Google positions through DataForSEO. Deploy the SEO stack, rebuild the dashboard,
        then add the DataForSEO login in Settings › AI Providers.
      </p>
    </div>
  );
}

/** The competitor domains of Settings › Brand Tracking, without the brand's own. */
function competitorsOf(list: RankTrackerList | null): CompetitorDomain[] {
  return list === null ? [] : competitorDomainEntries(list.competitor_domains, list.owned_domains);
}

function firstOf(trackers: readonly RankTracker[]): RankTracker | null {
  return trackers.length > 0 ? trackers[0] : null;
}

type Editing = { readonly tracker: RankTracker | null } | null;

function TrackerCard({
  tracker, selected, onSelect
}: {
  readonly tracker: RankTracker;
  readonly selected: boolean;
  readonly onSelect: () => void 
}) {
  const marketLabel = marketName(tracker.market_id, useMarketSelection().catalog.markets);
  return (
    <button
      type="button" onClick={onSelect} aria-pressed={selected}
      className={`text-left rounded-lg border p-3 ${selected ? 'border-gray-900 dark:border-gray-100' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-800`}
    >
      <span className="block font-medium">{tracker.domain}</span>
      <span className="block text-xs text-gray-500">
        {marketLabel} · {tracker.devices} · {SCHEDULE_LABELS[tracker.schedule]} · {tracker.keyword_count} keywords ({keywordScopeLabel(tracker)})
      </span>
    </button>
  );
}

interface TrackerListProps extends TrackRankingsCardProps {
  readonly trackers: readonly RankTracker[];
  readonly selected: RankTracker | null;
  readonly isAdmin: boolean;
  readonly onSelect: (tracker: RankTracker) => void;
}

/** The market's trackers; while it has none, the one-click card (Admins) or the empty state. */
function TrackerList(props: TrackerListProps) {
  if (props.trackers.length === 0) {
    return props.isAdmin ? (
      <TrackRankingsCard {...props} />
    ) : (
      <CenteredEmpty icon={null} title="No rank tracker in this market" hint="An Admin can track your domain to see where it ranks in Google for your keywords." />
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {props.trackers.map((tracker) => (
        <TrackerCard key={tracker.tracker_id} tracker={tracker} selected={tracker === props.selected}
          onSelect={() => props.onSelect(tracker)} />
      ))}
    </div>
  );
}

/**
 * The domains of Settings › Brand Tracking, the competitors' not yet tracked among `trackers`, and whether the
 * one-click card's "Track your rankings" (shown while the market has no tracker) already opens the form.
 */
function useTrackableDomains(list: RankTrackerList | null, trackers: readonly RankTracker[]) {
  return useMemo(() => {
    const competitors = competitorsOf(list);
    return {
      ownedDomains: list?.owned_domains ?? [],
      competitors,
      untrackedCompetitors: competitors.filter((competitor) => !trackers.some((tracker) => tracker.domain === competitor.domain)),
      cardOffersForm: trackers.length === 0 && (list?.owned_domains ?? []).length > 0,
    };
  }, [list, trackers]);
}

function ConfiguredRankTracking() {
  const { isAdmin } = useIsAdmin();
  const {
    selectedMarketId, catalog 
  } = useMarketSelection();
  const list = useRankTrackerList(true);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('tracker'));
  const [editing, setEditing] = useState<Editing>(null);
  const [archiving, setArchiving] = useState<RankTracker | null>(null);
  const [trackingCompetitors, setTrackingCompetitors] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const trackers = useMemo(() => (list.data?.trackers ?? []).filter(
    (tracker) => selectedMarketId === null || tracker.market_id === selectedMarketId,
  ), [list.data, selectedMarketId]);
  const selected = trackers.find((tracker) => tracker.tracker_id === selectedId) ?? firstOf(trackers);
  const nameOf = (marketId: string) => marketName(marketId, catalog.markets);
  // A new tracker goes to the header market; "every market combined" creates it for the keywords without one.
  const marketLabel = nameOf(selectedMarketId ?? GLOBAL_MARKET_ID);
  const {
    ownedDomains, competitors, untrackedCompetitors, cardOffersForm
  } = useTrackableDomains(list.data, trackers);

  const archive = (tracker: RankTracker) => {
    archiveRankTracker(tracker.tracker_id).then(list.reload, (failure: unknown) => setActionError(seoErrorMessage(failure)));
  };

  if (list.loading && list.data === null) {
    return <SkeletonRegion label="Loading rank trackers"><SkeletonCards count={3} /></SkeletonRegion>;
  }
  return (
    <div className="space-y-4">
      <PageHeaderCard title="Rank Tracking" relaxed={false}
        description="Where your domains and your competitors' rank in Google for your Settings keywords, in the market selected at the top of the page, per device, over time.">
        {isAdmin && !cardOffersForm && (
          <div>
            <Button onClick={() => setEditing({ tracker: null })}>
              Track a domain
            </Button>
          </div>
        )}
      </PageHeaderCard>
      {[list.error, actionError].map((message) => message !== null && <ErrorAlert key={message} message={message} />)}
      <TrackerList
        trackers={trackers} selected={selected} isAdmin={isAdmin} ownedDomain={ownedDomains[0] ?? null}
        competitorCount={untrackedCompetitors.length} marketId={selectedMarketId} marketLabel={marketLabel}
        onSelect={(tracker) => setSelectedId(tracker.tracker_id)} onTrackOwn={() => setEditing({ tracker: null })}
        onTrackCompetitors={() => setTrackingCompetitors(true)}
      />
      {selected !== null && (
        <TrackerDetail key={`${selected.tracker_id}|${selected.updated_at}`} tracker={selected} isAdmin={isAdmin}
          onEdit={() => setEditing({ tracker: selected })} onArchive={() => setArchiving(selected)} />
      )}
      {editing !== null && (
        <TrackerFormModal
          tracker={editing.tracker} marketId={selectedMarketId}
          marketLabel={editing.tracker === null ? marketLabel : nameOf(editing.tracker.market_id)}
          ownedDomains={ownedDomains} competitors={competitors} onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setSelectedId(saved.tracker_id);
            list.reload();
          }}
        />
      )}
      {trackingCompetitors && (
        <CompetitorTrackersModal
          competitors={untrackedCompetitors} marketId={selectedMarketId} marketLabel={marketLabel}
          onClose={() => setTrackingCompetitors(false)}
          onSaved={(refusals) => {
            setTrackingCompetitors(false);
            setActionError(refusals.length > 0 ? refusals.join(' · ') : null);
            list.reload();
          }}
        />
      )}
      <ConfirmModal
        isOpen={archiving !== null} onClose={() => setArchiving(null)} confirmVariant="danger" confirmText="Archive"
        title="Archive this tracker?" message="Scheduled checks stop. The ranking history is kept."
        onConfirm={() => archiving !== null && archive(archiving)}
      />
    </div>
  );
}

export function RankTrackingView() {
  return isSeoApiConfigured() ? <ConfiguredRankTracking /> : <RankTrackingNotSetUp />;
}
