import { getChartTheme } from '../../../ui/chartTheme';
import { buildGroupKpiChartConfiguration } from './groupKpiChartConfiguration';
import {
  buildKpis, buildRun, RUN_1, RUN_2
} from '../groupKpiHistory-fixtures';

/**
 * A group run at RUN_1 and a partial run at RUN_2, with distinct values for
 * every charted KPI; RUN_2's citation rate is unknown.
 */
export const CHART_RUNS = [
  buildRun({
    timestamp: RUN_1,
    kpis: buildKpis({
      mention_rate: 70,
      share_of_voice: 20,
      visibility_score: 58.1,
      top_1_share: 35,
      citation_rate: 29,
    }),
  }),
  buildRun({
    timestamp: RUN_2,
    is_group_run: false,
    kpis: buildKpis({
      mention_rate: 60,
      share_of_voice: 25,
      visibility_score: 52.4,
      top_1_share: 40,
      citation_rate: null,
    }),
  }),
];

/** The chart configuration of `CHART_RUNS` in light mode. */
export function lightChart() {
  return buildGroupKpiChartConfiguration(CHART_RUNS, getChartTheme(false), false);
}
