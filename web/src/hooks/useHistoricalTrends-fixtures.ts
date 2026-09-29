import type { HistoricalTrendsResponse } from '../types';
import {
  KEYWORD_SCOPE_INFO, buildTrendPoint, buildTrendsResponse
} from '../components/Visibility/visibilityOverview-fixtures';

/** `/trends` of the "Hotel Sol" group: two days, compared over one keyword. */
export const mockGroupTrendsResponse: HistoricalTrendsResponse = buildTrendsResponse();

/** `/trends` of one keyword before a second period: no change to report yet. */
export const mockFirstPeriodTrendsResponse: HistoricalTrendsResponse = buildTrendsResponse({
  scope: KEYWORD_SCOPE_INFO,
  keywords_analyzed: 1,
  trend_data: [buildTrendPoint()],
  change: null,
});


/**
 * Bodies the `/trends` guard must reject: a body that is not an object, a
 * full body flagged with a non-string error (a string one is rejected before
 * the guard), a body without its scope, the pre-KPI shapes and a new shape
 * missing `latest`.
 */
export const REJECTED_TRENDS_BODIES: ReadonlyArray<[description: string, body: unknown]> = [
  ['a null body', null],
  ['a full body flagged with a structured error', {
    ...mockGroupTrendsResponse,
    error: { message: 'No data' },
  }],
  ['a body without its scope', {
    ...mockGroupTrendsResponse,
    scope: null,
  }],
  ['the old single-keyword shape', {
    keyword: 'hotel sol spa',
    trend_data: [],
    trend_direction: 'stable',
  }],
  ['the old all-keywords shape', {
    keyword_trends: [],
    overall: { improving_count: 0 },
  }],
  ['a body without the latest KPIs', {
    ...mockGroupTrendsResponse,
    latest: null,
  }],
];
