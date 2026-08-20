/**
 * Chart.js theme tokens that adapt to light/dark mode.
 *
 * Use with `useTheme()` from `hooks/useTheme.ts` to keep Chart.js
 * canvases legible in both themes. Saturated dataset colours stay
 * fixed – only chrome (axis ticks, grid, legend, tooltip) adapts.
 *
 * See `docs/design-system.md#1-theming-model` for context.
 */

export interface ChartTheme {
  /** Axis tick + label + legend text colour. */
  readonly textColor: string;
  /** Axis grid line colour. */
  readonly gridColor: string;
  /** Tooltip surface colour. */
  readonly tooltipBackground: string;
  /** Tooltip border colour. */
  readonly tooltipBorder: string;
  /** Tooltip text colour. */
  readonly tooltipText: string;
}

const DARK_THEME: ChartTheme = {
  textColor: 'rgb(209, 213, 219)',
  gridColor: 'rgba(255, 255, 255, 0.08)',
  tooltipBackground: 'rgba(31, 41, 55, 0.95)',
  tooltipBorder: 'rgba(75, 85, 99, 1)',
  tooltipText: 'rgb(243, 244, 246)',
};

const LIGHT_THEME: ChartTheme = {
  textColor: 'rgb(75, 85, 99)',
  gridColor: 'rgba(0, 0, 0, 0.05)',
  tooltipBackground: 'rgba(17, 24, 39, 0.92)',
  tooltipBorder: 'rgba(75, 85, 99, 1)',
  tooltipText: 'rgb(249, 250, 251)',
};

export function getChartTheme(isDark: boolean): ChartTheme {
  return isDark ? DARK_THEME : LIGHT_THEME;
}

/**
 * Theme-aware Chart.js option fragments (bugs.md 4.4 — the tooltip block
 * below previously existed inline in four charts). Spread `themedTooltip`
 * into a chart's `plugins.tooltip`, adding chart-specific `callbacks` as
 * needed.
 */
export const themedLegend = (theme: ChartTheme) => ({
  display: true,
  position: 'bottom' as const,
  labels: { color: theme.textColor },
});

export const themedTooltip = (theme: ChartTheme) => ({
  backgroundColor: theme.tooltipBackground,
  borderColor: theme.tooltipBorder,
  borderWidth: 1,
  titleColor: theme.tooltipText,
  bodyColor: theme.tooltipText,
});

export const themedAxis = (theme: ChartTheme, extra: Record<string, unknown> = {}) => ({
  ticks: {
    color: theme.textColor,
    ...(extra.ticks as object ?? {}) 
  },
  grid: { color: theme.gridColor },
  ...extra,
});
