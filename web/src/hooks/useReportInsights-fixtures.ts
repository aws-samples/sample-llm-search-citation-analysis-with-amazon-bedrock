import { vi } from 'vitest';
import type { ReportInsightsResponse } from '../types/domain/insights';
import type { useReportInsights } from './useReportInsights';

interface HookStateOverrides {
  readonly loading?: boolean;
  readonly error?: string | null;
}

/** What `useReportInsights` returns with `data`, idle and error-free unless overridden. */
export function buildReportInsightsHookResult(
  data: ReportInsightsResponse | null,
  overrides: HookStateOverrides = {},
): ReturnType<typeof useReportInsights> {
  return {
    data,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    refetch: vi.fn(),
  };
}
