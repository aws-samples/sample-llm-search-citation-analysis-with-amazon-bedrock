import {
  describe, expect, it
} from 'vitest';
import {
  getChartTheme, themedLegend, themedTooltip
} from '../../../ui/chartTheme';
import {
  buildGroupKpiChartConfiguration, GROUP_KPI_SERIES, percentTick
} from './groupKpiChartConfiguration';
import {
  CHART_RUNS as RUNS, lightChart
} from './groupKpiChartConfiguration-fixtures';
import {
  RUN_1, RUN_2
} from '../groupKpiHistory-fixtures';

describe('buildGroupKpiChartConfiguration', () => {
  it('draws the citation rate, share of voice, rank #1 and top-3 shares', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.label)).toStrictEqual([
      'Citation rate', 'Share of voice', 'Rank #1 share', 'Top-3 share',
    ]);
  });

  it('plots each KPI per run, oldest first', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.data)).toStrictEqual([[80, 60], [30, 20], [50, 40], [90, 70]]);
  });

  it('labels each point with the run date', () => {
    expect(lightChart().data.labels).toStrictEqual([new Date(RUN_1).toLocaleDateString(), new Date(RUN_2).toLocaleDateString()]);
  });

  it('draws partial runs as hollow points', () => {
    expect(lightChart().data.datasets[0].backgroundColor).toStrictEqual([GROUP_KPI_SERIES[0].light, 'transparent']);
  });

  it('uses the dark palette in dark mode', () => {
    const chart = buildGroupKpiChartConfiguration(RUNS, getChartTheme(true), true);

    expect(chart.data.datasets.map((dataset) => dataset.borderColor)).toStrictEqual(GROUP_KPI_SERIES.map((series) => series.dark));
  });

  it('uses the light palette in light mode', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.pointBorderColor)).toStrictEqual(GROUP_KPI_SERIES.map((series) => series.light));
  });

  it('keeps every KPI on one 0-100% axis', () => {
    const y = lightChart().options?.scales?.y;

    expect([y?.min, y?.max]).toStrictEqual([0, 100]);
  });

  it('writes the axis ticks as percentages', () => {
    expect(percentTick(40)).toBe('40%');
  });

  it('formats the y axis ticks with the percentage writer', () => {
    expect(lightChart().options?.scales?.y?.ticks?.callback).toBe(percentTick);
  });

  it('is a responsive line chart that fills its fixed-height box', () => {
    const chart = lightChart();

    expect([chart.type, chart.options?.responsive, chart.options?.maintainAspectRatio]).toStrictEqual(['line', true, false]);
  });

  it('uses the themed legend and tooltip', () => {
    const theme = getChartTheme(false);

    expect(lightChart().options?.plugins).toStrictEqual({
      legend: themedLegend(theme),
      tooltip: themedTooltip(theme),
    });
  });

  it('gives every KPI its own colour in both themes', () => {
    const colours = GROUP_KPI_SERIES.flatMap((series) => [series.light, series.dark]);

    expect(new Set(colours.filter((colour) => colour.startsWith('rgb('))).size).toBe(8);
  });
});
