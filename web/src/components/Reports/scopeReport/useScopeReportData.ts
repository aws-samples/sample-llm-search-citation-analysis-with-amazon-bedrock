import { useEffect } from 'react';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import type {
  HistoricalTrendsResponse, PeriodType, ReportScope, VisibilityResponse
} from '../../../types';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';
import { useReportReady } from '../layout/useReportReady';
import { trendPeriodFor } from './scopeReportRoute';

/** One fetch of a report: its payload once settled, and whether it is loading or failed. */
export interface ReportSlice<T> {
  readonly data: T | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** What every scope report renders from. */
export interface ScopeReportData {
  /** `/visibility`: every KPI, brand, engine and source over each keyword's latest run. */
  readonly visibility: ReportSlice<VisibilityResponse>;
  /** `/trends` over the last `days` days, per `period`. */
  readonly trends: ReportSlice<HistoricalTrendsResponse>;
  readonly days: number;
  readonly period: PeriodType;
  /** Both fetches settled: the page may print. */
  readonly ready: boolean;
}

function sliceOf<T>({
  data, loading, error
}: ReportSlice<T>): ReportSlice<T> {
  return {
    data,
    loading,
    error,
  };
}

/**
 * The data of the Competitor Benchmark, AI Engines, Sources and Sentiment
 * reports: the latest runs of `scope` (`/visibility`) and its trend over
 * the last `days` days (`/trends`, daily up to 30 days, weekly beyond).
 * A new period refetches the trend only; a new scope refetches both.
 */
export function useScopeReportData(scope: ReportScope, days: number): ScopeReportData {
  const visibility = useVisibilityMetrics();
  const trends = useHistoricalTrends();
  const { fetchVisibilityMetrics } = visibility;
  const { fetchHistoricalTrends } = trends;
  const scopeKey = encodeReportScope(scope);
  const period = trendPeriodFor(days);

  useEffect(() => {
    fetchVisibilityMetrics(decodeReportScope(scopeKey));
  }, [scopeKey, fetchVisibilityMetrics]);

  useEffect(() => {
    fetchHistoricalTrends(decodeReportScope(scopeKey), period, days);
  }, [scopeKey, period, days, fetchHistoricalTrends]);

  const ready = useReportReady([visibility, trends]);

  return {
    visibility: sliceOf(visibility),
    trends: sliceOf(trends),
    days,
    period,
    ready,
  };
}
