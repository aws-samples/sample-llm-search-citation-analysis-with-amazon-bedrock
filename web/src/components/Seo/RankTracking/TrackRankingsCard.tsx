/**
 * "Track your rankings" (Admin), shown while the header market has no tracker: the brand's own domain from
 * Settings › Brand Tracking on every keyword of the market, with the defaults (mobile, top 30, weekly). The
 * button opens the prefilled form for review; nothing is created or paid for until its confirmation.
 * The keyword count comes from the free estimate (no DataForSEO call).
 */
import {
  useEffect, useState
} from 'react';
import { marketRequestField } from '../../../api/marketRequestField';
import { estimateRankTracker } from '../../../api/seoRankTracking';
import { Button } from '../../ui/Button';
import { SettingsHint } from '../SettingsHint';
import { ONE_CLICK_SETTINGS } from './CompetitorTrackersModal';
import { inMarketText } from './rankTrackingFormat';

export interface TrackRankingsCardProps {
  /** The brand's first own domain; `null` when Brand Tracking has none. */
  readonly ownedDomain: string | null;
  readonly competitorCount: number;
  readonly marketId: string | null;
  readonly marketLabel: string;
  readonly onTrackOwn: () => void;
  readonly onTrackCompetitors: () => void;
}

/** The keywords of the market a new tracker would check; `null` until the free estimate answers. */
function useMarketKeywordCount(marketId: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const request = { current: true };
    estimateRankTracker({
      ...ONE_CLICK_SETTINGS,
      ...marketRequestField(marketId),
    }).then((estimate) => {
      if (request.current) setCount(estimate.keyword_count);
    }, () => undefined);
    return () => {
      request.current = false;
    };
  }, [marketId]);
  return count;
}

function keywordsText(count: number | null): string {
  if (count === null) return 'your keywords';
  return `your ${count.toLocaleString('en-US')} ${count === 1 ? 'keyword' : 'keywords'}`;
}

export function TrackRankingsCard({
  ownedDomain, competitorCount, marketId, marketLabel, onTrackOwn, onTrackCompetitors
}: TrackRankingsCardProps) {
  const count = useMarketKeywordCount(marketId);
  return (
    <section aria-labelledby="track-rankings-title" className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-3">
      <h3 id="track-rankings-title" className="text-base font-semibold text-gray-900 dark:text-gray-50">Track your rankings</h3>
      {ownedDomain === null ? (
        <SettingsHint section="brand-config">Your website&apos;s domain is not set in Brand Tracking yet.</SettingsHint>
      ) : (
        <p className="text-sm text-gray-700 dark:text-gray-200">{`Track ${ownedDomain} for ${keywordsText(count)} ${inMarketText(marketLabel)}.`}</p>
      )}
      {count === 0 && <SettingsHint section="keywords">{`No active keyword ${inMarketText(marketLabel)} yet.`}</SettingsHint>}
      <p className="text-xs text-gray-500 dark:text-gray-400">All tracked keywords of the market · Mobile · Top 30 · Weekly. You review the paid checks before anything starts.</p>
      <div className="flex flex-wrap gap-2">
        {ownedDomain !== null && <Button onClick={onTrackOwn}>Track your rankings</Button>}
        {competitorCount > 0 && <Button variant="secondary" onClick={onTrackCompetitors}>Track competitors</Button>}
      </div>
    </section>
  );
}
