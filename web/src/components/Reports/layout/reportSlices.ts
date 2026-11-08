import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../../types';
import type { SectionFetchState } from './sectionGate';
import type { ComputingResponse } from '../../../types/domain/scopeCoverage';
import type { ListRequest } from '../../../api/scopedListPages';

/**
 * The props of every section that reads the `/trends` payload alone; `request` is the GET it
 * answered, so its lists page and its Export all exports the same query (2.45.0 wave 5).
 */
export interface TrendSectionProps extends SectionFetchState {
  readonly trends: HistoricalTrendsResponse | null;
  readonly request?: ListRequest | null;
}

/** The props of every section that reads the `/visibility` payload alone, with the GET it answered. */
export interface VisibilitySectionProps extends SectionFetchState {
  readonly visibility: VisibilityResponse | null;
  readonly request?: ListRequest | null;
}

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
  /** The `202` view jobs the fetches wait for (2.45.0); absent or `null` otherwise. */
  readonly visibilityComputing?: ComputingResponse | null;
  readonly trendsComputing?: ComputingResponse | null;
  /** The GETs the payloads answered (2.45.0 wave 5); absent in fixtures without them. */
  readonly visibilityRequest?: ListRequest | null;
  readonly trendsRequest?: ListRequest | null;
}

/** `request` for a slice: only when known, so a slice without one keeps its fields. */
function requestField(request: ListRequest | null | undefined): { request?: ListRequest } {
  return request === null || request === undefined ? {} : { request };
}

/** `computing` for a slice: only while a view job runs, so a settled slice keeps its three fields. */
function computingField(computing: ComputingResponse | null | undefined): { computing?: ComputingResponse } {
  return computing === null || computing === undefined ? {} : { computing };
}

/** The `/trends` slice of a report's data. */
export function trendSlice(data: VisibilityAndTrends): TrendSectionProps {
  return {
    trends: data.trends,
    loading: data.trendsLoading,
    error: data.trendsError,
    ...computingField(data.trendsComputing),
    ...requestField(data.trendsRequest),
  };
}

/** The `/visibility` slice of a report's data. */
export function visibilitySlice(data: VisibilityAndTrends): VisibilitySectionProps {
  return {
    visibility: data.visibility,
    loading: data.visibilityLoading,
    error: data.visibilityError,
    ...computingField(data.visibilityComputing),
    ...requestField(data.visibilityRequest),
  };
}

/** The headline reads both fetches: loading until both settle, failed when either does. */
export function headlineSlice(data: VisibilityAndTrends): VisibilityHeadlineProps {
  return {
    visibility: data.visibility,
    trends: data.trends,
    loading: data.visibilityLoading || data.trendsLoading,
    error: data.visibilityError ?? data.trendsError,
    ...computingField(data.visibilityComputing ?? data.trendsComputing),
  };
}
