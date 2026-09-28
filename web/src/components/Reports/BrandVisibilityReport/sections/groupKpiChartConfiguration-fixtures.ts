import { getChartTheme } from '../../../ui/chartTheme';
import { buildGroupKpiChartConfiguration } from './groupKpiChartConfiguration';
import {
  buildRun, buildSummary, RUN_1, RUN_2
} from '../groupKpiHistory-fixtures';

/** A group run at RUN_1 and a partial run at RUN_2, with distinct values for every charted KPI. */
export const CHART_RUNS = [
  buildRun({
    timestamp: RUN_1,
    summary: buildSummary({
      coverage_rate: 80,
      first_party_avg_sov: 30,
      rank_1_share: 50,
      top_3_share: 90,
    }),
  }),
  buildRun({
    timestamp: RUN_2,
    is_group_run: false,
    summary: buildSummary({
      coverage_rate: 60,
      first_party_avg_sov: 20,
      rank_1_share: 40,
      top_3_share: 70,
    }),
  }),
];

/** The chart configuration of `CHART_RUNS` in light mode. */
export function lightChart() {
  return buildGroupKpiChartConfiguration(CHART_RUNS, getChartTheme(false), false);
}
