import { vi } from 'vitest';
import type { ReportInsightsResponse } from '../types/domain/insights';
import type { useReportInsights } from './useReportInsights';
import {
  scopedHookState, type ScopedHookStateOverrides
} from '../test/scopedHookState';

/** What `useReportInsights` returns with `data`, idle and error-free unless overridden. */
export function buildReportInsightsHookResult(
  data: ReportInsightsResponse | null,
  overrides: ScopedHookStateOverrides = {},
): ReturnType<typeof useReportInsights> {
  return {
    data,
    ...scopedHookState(overrides),
    refetch: vi.fn(),
  };
}
