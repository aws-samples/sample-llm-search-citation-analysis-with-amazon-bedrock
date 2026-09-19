/**
 * Chart.js option builders for the keyword detail panel. Kept in a
 * separate file so `KeywordDetailComponents.tsx` stays under the
 * 400-line `max-lines` ESLint cap.
 *
 * Call with the result of `getChartTheme(isDark)` so chart chrome
 * (axis ticks, grid, legend, tooltip) adapts to the active theme.
 * The themed* fragments live next to the theme in `ui/chartTheme.ts`
 * (bugs.md 4.4).
 */
import type { ChartTheme } from '../ui/chartTheme';
import {
  themedAxis, themedLegend, themedTooltip
} from '../ui/chartTheme';

interface SimpleTooltipContext {
  readonly dataset: { readonly label?: string };
  readonly parsed: { readonly y: number | null };
}

interface KeywordTooltipCallbacks {
  readonly label: (context: SimpleTooltipContext) => string;
  readonly footer?: (tooltipItems: Array<{ readonly parsed: { readonly y: number | null } }>) => string;
}

/** "<dataset>: <value><unit>", e.g. "openai: 3 citations". */
const datasetValueLabel = (unit = '') => (context: SimpleTooltipContext) =>
  `${context.dataset.label ?? ''}: ${context.parsed.y ?? 0}${unit}`;

const themedPlugins = (theme: ChartTheme, callbacks: KeywordTooltipCallbacks) => ({
  legend: themedLegend(theme),
  tooltip: {
    ...themedTooltip(theme),
    callbacks,
  },
});

export const lineChartOptions = (theme: ChartTheme) => ({
  responsive: true,
  plugins: themedPlugins(theme, { label: datasetValueLabel(' citations') }),
  scales: {
    y: themedAxis(theme, { beginAtZero: true }),
    x: themedAxis(theme),
  },
});

export const barChartOptions = (theme: ChartTheme) => ({
  responsive: true,
  plugins: themedPlugins(theme, {
    label: datasetValueLabel(),
    footer: (tooltipItems) => {
      const total = tooltipItems.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0);
      return `Total: ${total}`;
    },
  }),
  scales: {
    x: themedAxis(theme, { stacked: true }),
    y: themedAxis(theme, {
      stacked: true,
      beginAtZero: true,
      ticks: { stepSize: 1 } 
    }),
  },
});
