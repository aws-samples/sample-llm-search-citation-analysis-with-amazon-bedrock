import type {
  HistoricalTrendsResponse, VisibilityMetricsResponse
} from '../../../types';
import {
  gateSection, type SectionGate
} from './sectionGate';

/** Inputs of a report's "Headline" section: the visibility snapshot it renders and the trend it annotates it with. */
export interface VisibilityHeadlineProps {
  readonly visibility: VisibilityMetricsResponse | null;
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * Gates a "Headline" section on its visibility payload. Every headline opens
 * with the same title and loading copy; only the empty-state message differs
 * by report.
 */
export function gateVisibilityHeadline(
  {
    visibility, loading, error
  }: VisibilityHeadlineProps,
  emptyMessage: string,
): SectionGate<VisibilityMetricsResponse> {
  return gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading visibility…',
    error,
    value: visibility,
    emptyMessage,
  });
}
