import type { ChartConfiguration } from 'chart.js';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import {
  themedAxis, themedLegend, themedTooltip, type ChartTheme
} from '../../../ui/chartTheme';

interface KpiSeries {
  readonly label: string;
  readonly value: (run: GroupRun) => number;
  readonly light: string;
  readonly dark: string;
}

/** The KPIs drawn over time, all percentages on one 0–100 axis. */
export const GROUP_KPI_SERIES: readonly KpiSeries[] = [
  {
    label: 'Citation rate',
    value: (run) => run.summary.coverage_rate,
    light: 'rgb(17, 24, 39)',
    dark: 'rgb(229, 231, 235)',
  },
  {
    label: 'Share of voice',
    value: (run) => run.summary.first_party_avg_sov,
    light: 'rgb(217, 119, 6)',
    dark: 'rgb(251, 191, 36)',
  },
  {
    label: 'Rank #1 share',
    value: (run) => run.summary.rank_1_share,
    light: 'rgb(109, 40, 217)',
    dark: 'rgb(167, 139, 250)',
  },
  {
    label: 'Top-3 share',
    value: (run) => run.summary.top_3_share,
    light: 'rgb(5, 150, 105)',
    dark: 'rgb(52, 211, 153)',
  },
];

/** A y-axis tick of the 0–100 scale, written as a percentage. */
export function percentTick(value: string | number): string {
  return `${value}%`;
}

/** A line per KPI over the runs, oldest first; partial runs are drawn as hollow points. */
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
          label: series.label,
          data: runs.map(series.value),
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
          ticks: { callback: percentTick },
        }),
      },
      plugins: {
        legend: themedLegend(theme),
        tooltip: themedTooltip(theme),
      },
    },
  };
}
