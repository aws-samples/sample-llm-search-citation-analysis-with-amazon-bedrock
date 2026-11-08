/**
 * Rank tracking client: `${SEO_API_BASE_URL}/seo/rank-trackers...` (`lambda/seo/seo-rank-tracking.py`).
 *
 * Creating, editing, archiving, changing keywords and starting a run are Admin routes (403 otherwise).
 * `startRankRun` is the only call here that spends money; it is never retried (a lost answer may
 * still have started the paid run). Every response is checked by `./seoRankTrackingDecoders`.
 */
import { decodeSeo } from './seoDecoders';
import {
  seoGet, seoPost, seoSend, type SeoRequestOptions
} from './seoRequest';
import {
  isLatestRun,
  isRankEstimate,
  isRankHistory,
  isRankKeywordsChanged,
  isRankResults,
  isRankRunStarted,
  isRankTrackerDetail,
  isRankTrackerList,
  isRankTrackerSaved,
  isRankTrend,
} from './seoRankTrackingDecoders';
import type {
  CreateRankTrackerRequest,
  RankEstimate,
  RankEstimateRequest,
  RankHistory,
  RankKeywordsChanged,
  RankPeriod,
  RankResults,
  RankRun,
  RankRunStarted,
  RankTrackerDetail,
  RankTrackerList,
  RankTrackerSaved,
  RankTrackerSettings,
  RankTrend,
} from '../types/api/seoRankTracking';

const BASE = '/rank-trackers';

function trackerPath(trackerId: string, sub = ''): string {
  return `${BASE}/${encodeURIComponent(trackerId)}${sub}`;
}

export async function fetchRankTrackers(options: SeoRequestOptions = {}): Promise<RankTrackerList> {
  return decodeSeo(await seoGet(BASE, {}, options), isRankTrackerList, 'rank tracker list');
}

export async function fetchRankTracker(trackerId: string): Promise<RankTrackerDetail> {
  return decodeSeo(await seoGet(trackerPath(trackerId)), isRankTrackerDetail, 'rank tracker');
}

export async function createRankTracker(request: CreateRankTrackerRequest): Promise<RankTrackerSaved> {
  return decodeSeo(await seoPost(BASE, request), isRankTrackerSaved, 'rank tracker');
}

export async function updateRankTracker(trackerId: string, settings: RankTrackerSettings): Promise<RankTrackerSaved> {
  return decodeSeo(await seoSend('PUT', trackerPath(trackerId), settings), isRankTrackerSaved, 'rank tracker');
}

export async function archiveRankTracker(trackerId: string): Promise<RankTrackerSaved> {
  return decodeSeo(await seoSend('DELETE', trackerPath(trackerId)), isRankTrackerSaved, 'rank tracker');
}

export async function addRankKeywords(trackerId: string, keywords: string[]): Promise<RankKeywordsChanged> {
  const payload = await seoPost(trackerPath(trackerId, '/keywords'), { keywords });
  return decodeSeo(payload, isRankKeywordsChanged, 'keyword change');
}

/** Removes hand-added keywords (Admin); their stored ranking history stays. */
export async function removeRankKeywords(trackerId: string, keywordIds: string[]): Promise<RankKeywordsChanged> {
  const query = new URLSearchParams({ keyword_ids: keywordIds.join(',') });
  const payload = await seoSend('DELETE', `${trackerPath(trackerId, '/keywords')}?${query.toString()}`);
  return decodeSeo(payload, isRankKeywordsChanged, 'keyword change');
}

/** Free: no DataForSEO call. */
export async function estimateRankTracker(request: RankEstimateRequest): Promise<RankEstimate> {
  return decodeSeo(await seoPost(`${BASE}/estimate`, request), isRankEstimate, 'cost estimate');
}

/** Paid: starts a live rank check of every keyword (answers once the run is queued, 202). */
export async function startRankRun(trackerId: string): Promise<RankRunStarted> {
  return decodeSeo(await seoPost(trackerPath(trackerId, '/runs'), {}), isRankRunStarted, 'rank check run');
}

export async function fetchLatestRankRun(trackerId: string): Promise<RankRun | null> {
  return decodeSeo(await seoGet(trackerPath(trackerId, '/runs')), isLatestRun, 'rank check run').run;
}

export async function fetchRankResults(trackerId: string, period: RankPeriod): Promise<RankResults> {
  return decodeSeo(await seoGet(trackerPath(trackerId, '/results'), { period }), isRankResults, 'rank results');
}

export async function fetchRankHistory(trackerId: string, keywordId: string): Promise<RankHistory> {
  const payload = await seoGet(trackerPath(trackerId, '/history'), { keyword_id: keywordId });
  return decodeSeo(payload, isRankHistory, 'keyword history');
}

export async function fetchRankTrend(trackerId: string, days: number): Promise<RankTrend> {
  return decodeSeo(await seoGet(trackerPath(trackerId, '/trend'), { days: String(days) }), isRankTrend, 'rank trend');
}
