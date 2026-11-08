/**
 * The dashboard's "Rankings" card: how many tracked keywords sit in Google's
 * top 3 and top 10 at each tracker's newest check, summed over the trackers
 * of the header market. Only free reads (the tracker list and each tracker's
 * position distribution); nothing here starts a rank check.
 */
import {
  fetchRankTrackers, fetchRankTrend
} from '../../api/seoRankTracking';
import type {
  RankTracker, RankTrendPoint
} from '../../types/api/seoRankTracking';

/** Long enough to reach the last check of a monthly tracker. */
const TREND_DAYS = 35;

export interface RankingsSummary {
  readonly trackers: number;
  /** Trackers with at least one finished check in the trend window. */
  readonly checkedTrackers: number;
  readonly keywords: number;
  readonly top3: number;
  readonly top10: number;
}

/** The newest check of a trend; desktop when both devices were checked in it. */
export function newestTrendPoint(points: readonly RankTrendPoint[]): RankTrendPoint | null {
  return points.reduce<RankTrendPoint | null>((best, point) => {
    if (best === null || point.started_at > best.started_at) return point;
    if (point.started_at === best.started_at && point.device === 'desktop') return point;
    return best;
  }, null);
}

export function summarizeRankings(newest: readonly (RankTrendPoint | null)[]): RankingsSummary {
  const checked = newest.filter((point): point is RankTrendPoint => point !== null);
  const total = (pick: (point: RankTrendPoint) => number) => checked.reduce((sum, point) => sum + pick(point), 0);
  return {
    trackers: newest.length,
    checkedTrackers: checked.length,
    keywords: total((point) => point.total),
    top3: total((point) => point.top3),
    top10: total((point) => point.top3 + point.top4_10),
  };
}

function inMarket(tracker: RankTracker, marketId: string | null): boolean {
  return tracker.is_active && (marketId === null || tracker.market_id === marketId);
}

/** Reads the active trackers of `marketId` (`null` = every market) and sums their newest checks. */
export async function loadRankingsSummary(marketId: string | null): Promise<RankingsSummary> {
  const list = await fetchRankTrackers();
  const trackers = list.trackers.filter((tracker) => inMarket(tracker, marketId));
  const trends = await Promise.all(trackers.map((tracker) => fetchRankTrend(tracker.tracker_id, TREND_DAYS)));
  return summarizeRankings(trends.map((trend) => newestTrendPoint(trend.points)));
}
