import type { ChartConfiguration } from 'chart.js';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../../constants/kpiDefinitions';
import {
  themedAxis, themedLegend, themedTooltip, type ChartTheme
} from '../../../ui/chartTheme';

interface KpiSeries {
  readonly id: KpiId;
  readonly light: string;
  readonly dark: string;
}

/** The KPIs drawn over time: percentages and the visibility score, all on one 0–100 axis. */
export const GROUP_KPI_SERIES: readonly KpiSeries[] = [
  {
    id: 'mention_rate',
    light: 'rgb(17, 24, 39)',
    dark: 'rgb(229, 231, 235)',
  },
  {
    id: 'share_of_voice',
    light: 'rgb(217, 119, 6)',
    dark: 'rgb(251, 191, 36)',
  },
  {
    id: 'visibility_score',
    light: 'rgb(109, 40, 217)',
    dark: 'rgb(167, 139, 250)',
  },
  {
    id: 'top_1_share',
    light: 'rgb(5, 150, 105)',
    dark: 'rgb(52, 211, 153)',
  },
  {
    id: 'citation_rate',
    light: 'rgb(37, 99, 235)',
    dark: 'rgb(96, 165, 250)',
  },
];

/** A line per KPI over the runs, oldest first; partial runs are drawn as hollow points and unknown values as gaps. */
export function buildGroupKpiChartConfiguration(
  runs: GroupRun[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels: runs.map((run) => formatDateOnly(run.timestamp)),
      datasets: GROUP_KPI_SERIES.map((series) => {
        const color = isDark ? series.dark : series.light;
        return {
          label: KPI_DEFINITIONS[series.id].label,
          data: runs.map((run) => run.kpis[series.id]),
          borderColor: color,
          backgroundColor: runs.map((run) => (run.is_group_run ? color : 'transparent')),
          pointBorderColor: color,
          pointRadius: 4,
          tension: 0.2,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: themedAxis(theme),
        y: themedAxis(theme, {
          min: 0,
          max: 100,
        }),
      },
      plugins: {
        legend: themedLegend(theme),
        tooltip: themedTooltip(theme),
      },
    },
  };
}
