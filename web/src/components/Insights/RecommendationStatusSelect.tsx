import type {
  Recommendation, RecommendationStatus
} from '../../types';
import { RECOMMENDATION_STATUSES } from '../../api/recommendations';

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  done: 'Done',
  wontfix: "Won't fix",
};

interface RecommendationStatusSelectProps {
  readonly recommendation: Recommendation & { id: string };
  readonly updating: boolean;
  readonly onChange: (recommendation: Recommendation & { id: string }, status: RecommendationStatus) => void;
}

function asStatus(value: string): RecommendationStatus | undefined {
  return RECOMMENDATION_STATUSES.find((status) => status === value);
}

/** Where a recommendation stands; changing it saves at once. Clicks stay inside so the card does not toggle. */
export const RecommendationStatusSelect = ({
  recommendation, updating, onChange
}: RecommendationStatusSelectProps) => (
  <select
    aria-label={`Status of ${recommendation.title}`}
    value={recommendation.status ?? 'new'}
    disabled={updating}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => {
      const status = asStatus(event.target.value);
      if (status !== undefined) onChange(recommendation, status);
    }}
    className="text-xs rounded-lg border border-gray-300 bg-white px-2 py-1 text-gray-700 disabled:opacity-50"
  >
    {RECOMMENDATION_STATUSES.map((status) => (
      <option key={status} value={status}>{RECOMMENDATION_STATUS_LABELS[status]}</option>
    ))}
  </select>
);
