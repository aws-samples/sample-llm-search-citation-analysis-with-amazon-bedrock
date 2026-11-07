import {
  useCallback, useState
} from 'react';
import {
  fetchRankHistory, fetchRankResults, fetchRankTracker, fetchRankTrackers, fetchRankTrend
} from '../api/seoRankTracking';
import type {
  RankHistory, RankPeriod, RankResults, RankTrackerDetail, RankTrackerList, RankTrend
} from '../types/api/seoRankTracking';
import {
  useSeoRequest, type SeoRequestState
} from './useSeoGeoRequest';

/** Trend window of the detail view, days. */
export const TREND_DAYS = 90;

export interface Reloadable<T> extends SeoRequestState<T> {readonly reload: () => void;}

function useReloadKey(): [number, () => void] {
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey((value) => value + 1), []);
  return [key, reload];
}

/**
 * The trackers (free read, no DataForSEO call), loaded on mount and on `reload`.
 * Inactive (nothing fetched) when the SEO stack is not deployed.
 */
export function useRankTrackerList(active: boolean): Reloadable<RankTrackerList> {
  const [key, reload] = useReloadKey();
  const state = useSeoRequest(active, String(key), () => fetchRankTrackers());
  return {
    ...state,
    reload,
  };
}

export interface RankTrackerData {
  readonly detail: SeoRequestState<RankTrackerDetail>;
  readonly results: SeoRequestState<RankResults>;
  readonly trend: SeoRequestState<RankTrend>;
  readonly reload: () => void;
}

/** One tracker's keywords, latest results compared with `period` ago, and trend (free reads). */
export function useRankTrackerData(trackerId: string | null, period: RankPeriod): RankTrackerData {
  const [key, reload] = useReloadKey();
  const active = trackerId !== null;
  const id = trackerId ?? '';
  const detail = useSeoRequest(active, `${id}|${key}`, () => fetchRankTracker(id));
  const results = useSeoRequest(active, `${id}|${period}|${key}`, () => fetchRankResults(id, period));
  const trend = useSeoRequest(active, `${id}|${key}`, () => fetchRankTrend(id, TREND_DAYS));
  return {
    detail,
    results,
    trend,
    reload,
  };
}

/** One keyword's history (free read) while `keywordId` is set. */
export function useRankKeywordHistory(trackerId: string, keywordId: string | null): SeoRequestState<RankHistory> {
  return useSeoRequest(keywordId !== null, `${trackerId}|${keywordId ?? ''}`,
    () => fetchRankHistory(trackerId, keywordId ?? ''));
}
