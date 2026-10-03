import type { HistoricalTrendsResponse } from '../../../types';
import type { TrendSectionProps } from './reportSlices';

/** A data slice whose request is still in flight. */
export const LOADING_SLICE = {
  data: null,
  loading: true,
  error: null,
} as const;

/** A data slice whose request has settled with `data`, and `error` when it failed. */
export function settledSlice<T>(data: T, error: string | null = null) {
  return {
    data,
    loading: false,
    error,
  };
}

/** A data slice whose request failed with `error`. */
export function failedSlice(error: string) {
  return settledSlice(null, error);
}

/** The props of a `/trends` section whose request has settled with `trends`. */
export function settledTrends(trends: HistoricalTrendsResponse | null): TrendSectionProps {
  return {
    trends,
    loading: false,
    error: null,
  };
}
