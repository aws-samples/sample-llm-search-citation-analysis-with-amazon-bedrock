import type { useBrandVisibilityReport } from './useBrandVisibilityReport';
import {
  buildTrendView, buildVisibility, movingKeyword
} from '../layout/reportPayload-fixtures';
import { buildHistory } from './groupKpiHistory-fixtures';

/** A data slice whose request is still in flight. */
export const LOADING_SLICE = {
  data: null,
  loading: true,
  error: null,
} as const;

/** A data slice whose request failed with `error`. */
export function failedSlice(error: string) {
  return {
    data: null,
    loading: false,
    error,
  };
}

type ReportData = ReturnType<typeof useBrandVisibilityReport>;

/** Every slice of the report settled and empty, unless overridden. */
function settledReport(overrides: Partial<ReportData>): ReportData {
  return {
    scope: { kind: 'all' },
    keyword: null,
    visibility: null,
    visibilityLoading: false,
    visibilityError: null,
    trends: null,
    trendsLoading: false,
    trendsError: null,
    groupHistory: null,
    groupHistoryLoading: false,
    groupHistoryError: null,
    ready: true,
    ...overrides,
  };
}

/** The per-keyword report of "best running shoes": `buildVisibility()` and a two-day trend. */
export function keywordReportData(): ReportData {
  return settledReport({
    scope: {
      kind: 'keyword',
      keyword: 'best running shoes',
    },
    keyword: 'best running shoes',
    visibility: buildVisibility(),
    trends: buildTrendView(),
  });
}

/** The all-keywords report: "best running shoes" improving, "best hiking boots" declining. */
export function allKeywordsReportData(): ReportData {
  return settledReport({
    trends: buildTrendView({
      keyword_trends: [
        movingKeyword('best running shoes', 8, 'improving', 80),
        movingKeyword('best hiking boots', -10, 'declining', 30),
      ],
      overall: {
        improving_count: 1,
        declining_count: 1,
        stable_count: 0,
      },
    }),
  });
}

/** The group report of "hotel-sol": `buildHistory()`. */
export function groupReportData(): ReportData {
  return settledReport({
    scope: {
      kind: 'group',
      groupId: 'hotel-sol',
    },
    groupHistory: buildHistory(),
  });
}
