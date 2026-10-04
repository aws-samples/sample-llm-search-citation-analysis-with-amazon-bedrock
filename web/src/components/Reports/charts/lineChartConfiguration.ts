import type { ChartConfiguration } from 'chart.js';
import type { ChartTheme } from '../../ui/chartTheme';
import { resolveColour } from './chartPalette';
import { percentChartOptions } from './chartOptions';
import {
  seriesLabels, valuesAt, type ChartSeries
} from './chartSeries';

/** Line and point size of an emphasised (tracked brand) and a regular series. */
export const LINE_WEIGHTS = {
  emphasised: {
    borderWidth: 4,
    pointRadius: 4,
  },
  regular: {
    borderWidth: 2,
    pointRadius: 3,
  },
} as const;

/** A line per series over the point labels, on a 0–100 axis; unknown values are gaps, never bridged. */
export function lineChartConfiguration(
  series: readonly ChartSeries[],
  theme: ChartTheme,
  isDark: boolean,
): ChartConfiguration<'line'> {
  const labels = seriesLabels(series);
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map((line) => {
        const colour = resolveColour(line.colour, isDark);
        return {
          label: line.label,
          data: valuesAt(line, labels),
          borderColor: colour,
          backgroundColor: colour,
          ...LINE_WEIGHTS[line.emphasised ? 'emphasised' : 'regular'],
          spanGaps: false,
          tension: 0.2,
        };
      }),
    },
    options: percentChartOptions(theme),
  };
}
