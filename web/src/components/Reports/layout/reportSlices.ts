import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../../types';
import type { SectionFetchState } from './sectionGate';

/** The props of every section that reads the `/trends` payload alone. */
export interface TrendSectionProps extends SectionFetchState {readonly trends: HistoricalTrendsResponse | null;}

/** The props of every section that reads the `/visibility` payload alone. */
export interface VisibilitySectionProps extends SectionFetchState {readonly visibility: VisibilityResponse | null;}

/** Inputs of a report's "Headline" section: the visibility snapshot it renders and the trend whose change annotates it. */
export interface VisibilityHeadlineProps extends VisibilitySectionProps {readonly trends: HistoricalTrendsResponse | null;}

/** `/visibility` and `/trends` as the Brand Visibility and Keyword Deep Dive hooks return them. */
export interface VisibilityAndTrends {
  readonly visibility: VisibilityResponse | null;
  readonly visibilityLoading: boolean;
  readonly visibilityError: string | null;
  readonly trends: HistoricalTrendsResponse | null;
  readonly trendsLoading: boolean;
  readonly trendsError: string | null;
}

/** The `/trends` slice of a report's data. */
export function trendSlice(data: VisibilityAndTrends): TrendSectionProps {
  return {
    trends: data.trends,
    loading: data.trendsLoading,
    error: data.trendsError,
  };
}

/** The `/visibility` slice of a report's data. */
export function visibilitySlice(data: VisibilityAndTrends): VisibilitySectionProps {
  return {
    visibility: data.visibility,
    loading: data.visibilityLoading,
    error: data.visibilityError,
  };
}

/** The headline reads both fetches: loading until both settle, failed when either does. */
export function headlineSlice(data: VisibilityAndTrends): VisibilityHeadlineProps {
  return {
    visibility: data.visibility,
    trends: data.trends,
    loading: data.visibilityLoading || data.trendsLoading,
    error: data.visibilityError ?? data.trendsError,
  };
}
