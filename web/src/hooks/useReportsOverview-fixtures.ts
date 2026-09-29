import type { ReportsOverviewResponse } from '../api/reports';
import {
  buildMover, buildOverview
} from '../components/Reports/layout/reportPayload-fixtures';
import { buildRec } from '../components/Reports/ExecutiveSummaryReport/sections/reportsOverview-fixtures';

/** A settled `/reports/overview` with one mover on each side and one recommendation. */
export const mockReportsOverview: ReportsOverviewResponse = buildOverview({
  top_improving: [buildMover('a', 8, 80)],
  top_declining: [buildMover('c', -10, 30)],
  top_recommendations: [buildRec('r1', 'high')],
});


/** `mockReportsOverview` without its `field`, as a backend predating that field answers. */
export function overviewWithout(field: keyof ReportsOverviewResponse): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mockReportsOverview).filter(([key]) => key !== field));
}
