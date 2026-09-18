import { useEffect } from 'react';
import { useReportsOverview } from '../../../hooks/useReportsOverview';
import { useReportReady } from '../layout/useReportReady';
import type { ReportScope } from '../../../types';
import {
  ALL_SCOPE, decodeReportScope, encodeReportScope
} from '../../ui/reportScope';

const DEFAULT_DAYS = 30;
const TOP_N = 3;

/**
 * Composes the single backend slice that powers the Executive Summary
 * report. Defaults to a 30-day window with three movers and three
 * recommendations — matches the print-friendly density on the layout.
 * `scope` narrows the summary to a keyword group (a hotel).
 *
 * Imperative `fetchReportsOverview` is wrapped in an effect so the
 * hook reads more like the other report-data hooks in this folder
 * (each effect has a stable dependency list and only re-fires when
 * the input parameters change).
 */
export function useExecutiveSummary(days: number = DEFAULT_DAYS, scope: ReportScope = ALL_SCOPE) {
  const overview = useReportsOverview();
  const { fetchReportsOverview } = overview;
  const scopeKey = encodeReportScope(scope);

  useEffect(() => {
    fetchReportsOverview(days, 'day', TOP_N, decodeReportScope(scopeKey));
  }, [days, scopeKey, fetchReportsOverview]);

  const ready = useReportReady([overview]);

  return {
    data: overview.data,
    loading: overview.loading,
    error: overview.error,
    ready,
  };
}
