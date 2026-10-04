import type { ReportsOverviewResponse } from '../../../../api/reports';
import type { Recommendation } from '../../../../types';
import type { ReportSlice } from '../../layout';
import { buildOverview } from '../../layout/reportPayload-fixtures';

/** A recommendation titled `title` whose description, action and impact name it. */
export function buildRec(
  title: string,
  priority: 'high' | 'medium' | 'low',
  overrides: Partial<Recommendation> = {},
): Recommendation {
  return {
    type: 'gap',
    priority,
    title,
    description: 'Description for ' + title,
    action: 'Action for ' + title,
    impact: 'Impact for ' + title,
    ...overrides,
  };
}

/** The overview slice of a report section once `buildOverview(overrides)` has loaded. */
export function loadedOverview(overrides: Partial<ReportsOverviewResponse> = {}): ReportSlice<ReportsOverviewResponse> {
  return {
    data: buildOverview(overrides),
    loading: false,
    error: null,
  };
}
