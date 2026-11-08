import {
  useCallback, useState
} from 'react';
import { fetchSeoInsights } from '../api/seoDomains';
import { saveRecommendationStatus } from '../api/recommendations';
import { getErrorMessage } from '../infrastructure';
import type { RecommendationStatus } from '../types';
import type {
  SeoInsightsResponse, SeoRecommendation
} from '../types/api/seoDomains';
import {
  useSeoScopeRequest, type SeoScopeRequest
} from './useSeoGeoRequest';

export interface SeoGeoInsightsState extends SeoScopeRequest<SeoInsightsResponse> {
  /** Each recommendation with the status saved in this session applied. */
  readonly recommendations: readonly SeoRecommendation[];
  readonly updatingIds: readonly string[];
  readonly statusError: string | null;
  readonly updateStatus: (recommendation: SeoRecommendation, status: RecommendationStatus) => Promise<void>;
}

interface Tracking {
  /** Status saved in this session, by recommendation id. */
  readonly saved: Readonly<Record<string, RecommendationStatus>>;
  readonly pending: readonly string[];
  readonly failure: string | null;
}

const UNTRACKED: Tracking = {
  saved: {},
  pending: [],
  failure: null,
};

/** `current` with the save of `id` settled: no longer pending, its stored status or failure recorded. */
function settled(current: Tracking, id: string, change: Partial<Tracking>): Tracking {
  return {
    ...current,
    ...change,
    saved: {
      ...current.saved,
      ...change.saved,
    },
    pending: current.pending.filter((pendingId) => pendingId !== id),
  };
}

/**
 * The SEO recommendations (`GET /api/seo/insights`, no DataForSEO call) of
 * the header market and `groupId`, fetched on mount and when either changes.
 * Status changes go to the Action Center's own route, so a recommendation
 * tracked here shows the same status there.
 */
export function useSeoGeoInsights(groupId: string | null): SeoGeoInsightsState {
  const request = useSeoScopeRequest(groupId, fetchSeoInsights);
  const [tracking, setTracking] = useState<Tracking>(UNTRACKED);

  const updateStatus = useCallback(async (recommendation: SeoRecommendation, status: RecommendationStatus) => {
    const settle = (id: string, change: Partial<Tracking>) => setTracking((current) => settled(current, id, change));
    setTracking((current) => ({
      ...current,
      failure: null,
      pending: [...current.pending, recommendation.id],
    }));
    await saveRecommendationStatus(recommendation, status).then(
      (stored) => settle(recommendation.id, { saved: { [recommendation.id]: stored } }),
      (failure: unknown) => settle(recommendation.id, { failure: getErrorMessage(failure) }),
    );
  }, []);

  return {
    ...request,
    recommendations: (request.data?.recommendations ?? []).map((item) => ({
      ...item,
      status: tracking.saved[item.id] ?? item.status,
    })),
    updatingIds: tracking.pending,
    statusError: tracking.failure,
    updateStatus,
  };
}
