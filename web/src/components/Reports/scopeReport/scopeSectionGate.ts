import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../../types';
import {
  gateSection, type SectionGate
} from '../layout/sectionGate';
import type { ScopeReportData } from './useScopeReportData';

/** What a section of a scope report receives. */
export interface ScopeSectionProps {readonly report: ScopeReportData;}

export const LATEST_RUNS_LOADING = 'Loading the latest runs…';

export const TREND_LOADING = 'Loading the trend…';

/** Shown by every latest-run section while the scope has no answered run. */
export const NO_ANSWERED_RUN = 'No AI answers in this scope yet. Run an analysis or choose another scope.';

/** Shown by every trend section while the period has no run. */
export function noTrendMessage(days: number): string {
  return `No analysis run in the last ${days} days. Run an analysis or choose a longer period.`;
}

/**
 * Gates a section on the latest runs (`/visibility`): loading, then error,
 * then empty while no keyword of the scope has an answered run.
 */
export function gateLatestRuns(report: ScopeReportData, title: string): SectionGate<VisibilityResponse> {
  const {
    data, loading, error
  } = report.visibility;
  return gateSection({
    title,
    loading,
    loadingMessage: LATEST_RUNS_LOADING,
    error,
    value: data !== null && data.keywords_with_data > 0 ? data : null,
    emptyMessage: NO_ANSWERED_RUN,
  });
}

/** Gates a section on the trend (`/trends`): loading, then error, then empty while the period has no run. */
export function gateTrend(report: ScopeReportData, title: string): SectionGate<HistoricalTrendsResponse> {
  const {
    data, loading, error
  } = report.trends;
  return gateSection({
    title,
    loading,
    loadingMessage: TREND_LOADING,
    error,
    value: data !== null && data.trend_data.length > 0 ? data : null,
    emptyMessage: noTrendMessage(report.days),
  });
}

/** "per day over the last 30 days", "per week over the last 90 days". */
export function trendWindow(report: ScopeReportData): string {
  return `per ${report.period} over the last ${report.days} days`;
}
