import { apiPost } from './client';
import type {
  Recommendation, RecommendationStatus
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';

export class InvalidRecommendationStatusResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecommendationStatusResponseError';
  }
}

/** Every status `POST /api/recommendations/{id}/status` accepts, in the order the Action Center offers them. */
export const RECOMMENDATION_STATUSES: readonly RecommendationStatus[] = ['new', 'in_progress', 'done', 'wontfix'];

function isRecommendationStatus(value: unknown): value is RecommendationStatus {
  return RECOMMENDATION_STATUSES.some((status) => status === value);
}

interface StoredRecommendationStatus {
  recommendation_id: string;
  status: RecommendationStatus;
}

function isStoredRecommendationStatus(value: unknown): value is StoredRecommendationStatus {
  return isRecord(value)
    && typeof value.recommendation_id === 'string'
    && isRecommendationStatus(value.status);
}

/**
 * Stores `status` for `recommendation` and returns the status the API saved.
 *
 * The endpoint replaces the whole stored row, so the notes and links the
 * recommendation already carries are sent back with the new status rather
 * than being wiped.
 */
export async function saveRecommendationStatus(
  recommendation: Recommendation & { id: string },
  status: RecommendationStatus
): Promise<RecommendationStatus> {
  const payload = await apiPost<unknown>(
    `/recommendations/${encodeURIComponent(recommendation.id)}/status`,
    {
      status,
      notes: recommendation.notes,
      related_keyword: recommendation.related_keyword,
      related_content_id: recommendation.related_content_id,
    },
    { allowStructured4xx: true }
  );
  if (!isStoredRecommendationStatus(payload) || payload.recommendation_id !== recommendation.id) {
    throw new InvalidRecommendationStatusResponseError('Recommendations API returned an invalid status');
  }
  return payload.status;
}
