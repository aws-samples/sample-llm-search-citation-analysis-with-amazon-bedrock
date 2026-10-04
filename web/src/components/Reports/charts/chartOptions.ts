/**
 * Option fragments every report chart shares: a responsive chart filling
 * its fixed-height box, the themed legend and tooltip, and the 0–100 axis
 * of the percentages and scores.
 */
import type { ChartConfiguration } from 'chart.js';
import {
  themedAxis, themedLegend, themedTooltip, type ChartTheme
} from '../../ui/chartTheme';
import {
  resolveColour, type ThemedColour
} from './chartPalette';
import {
  seriesLabels, valuesAt, type ChartSeries
} from './chartSeries';

/** A themed axis from 0 to 100 (percentages and scores). */
export function percentAxis(theme: ChartTheme, extra: Record<string, unknown> = {}) {
  return themedAxis(theme, {
    ...extra,
    min: 0,
    max: 100,
  });
}

/** Responsive options with the themed legend and tooltip around `scales`. */
export function chartOptions<TScales>(theme: ChartTheme, scales: TScales) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales,
    plugins: {
      legend: themedLegend(theme),
      tooltip: themedTooltip(theme),
    },
  };
}

/** Options of a chart over categories on x and the shared 0–100 scale on y. */
export function percentChartOptions(theme: ChartTheme) {
  return chartOptions(theme, {
    x: themedAxis(theme),
    y: percentAxis(theme),
  });
}

/** A bar chart under `options`: the category labels and one bar dataset per series, in the series' colours. */
export function barChartConfiguration(
  series: readonly ChartSeries[],
  isDark: boolean,
  options: ChartConfiguration<'bar'>['options'],
): ChartConfiguration<'bar'> {
  const labels = seriesLabels(series);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: series.map((bar) => ({
        label: bar.label,
        data: valuesAt(bar, labels),
        backgroundColor: resolveColour(bar.colour, isDark),
      })),
    },
    options,
  };
}

/** `colours` for the current theme, one per slice or bar. */
export function resolveColours(colours: readonly ThemedColour[], isDark: boolean): string[] {
  return colours.map((colour) => resolveColour(colour, isDark));
}
