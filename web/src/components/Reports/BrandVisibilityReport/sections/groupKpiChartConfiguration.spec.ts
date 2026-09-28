import {
  describe, expect, it
} from 'vitest';
import {
  getChartTheme, themedAxis, themedLegend, themedTooltip
} from '../../../ui/chartTheme';
import {
  buildGroupKpiChartConfiguration, GROUP_KPI_SERIES
} from './groupKpiChartConfiguration';
import {
  CHART_RUNS as RUNS, lightChart
} from './groupKpiChartConfiguration-fixtures';
import {
  RUN_1, RUN_2
} from '../groupKpiHistory-fixtures';
import { KPI_DEFINITIONS } from '../../../../constants/kpiDefinitions';

describe('buildGroupKpiChartConfiguration', () => {
  it('draws the mention rate, share of voice, visibility score, top-1 share and citation rate', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.label)).toStrictEqual([
      'Mention rate', 'Share of voice', 'Visibility score', 'Top-1 share', 'Citation rate',
    ]);
  });

  it('names every line after its KPI definition', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.label))
      .toStrictEqual(GROUP_KPI_SERIES.map((series) => KPI_DEFINITIONS[series.id].label));
  });

  it('plots each KPI from the run KPIs, oldest first, with an unknown value as a gap', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.data)).toStrictEqual([
      [70, 60], [20, 25], [58.1, 52.4], [35, 40], [29, null],
    ]);
  });

  it('labels each point with the run date', () => {
    expect(lightChart().data.labels).toStrictEqual([new Date(RUN_1).toLocaleDateString(), new Date(RUN_2).toLocaleDateString()]);
  });

  it('draws partial runs as hollow points on every line', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.backgroundColor))
      .toStrictEqual(GROUP_KPI_SERIES.map((series) => [series.light, 'transparent']));
  });

  it('uses the dark palette in dark mode', () => {
    const chart = buildGroupKpiChartConfiguration(RUNS, getChartTheme(true), true);

    expect(chart.data.datasets.map((dataset) => dataset.borderColor)).toStrictEqual(GROUP_KPI_SERIES.map((series) => series.dark));
  });

  it('uses the light palette in light mode', () => {
    expect(lightChart().data.datasets.map((dataset) => dataset.pointBorderColor)).toStrictEqual(GROUP_KPI_SERIES.map((series) => series.light));
  });

  it('keeps every KPI on one plain 0-100 axis', () => {
    expect(lightChart().options?.scales?.y).toStrictEqual(themedAxis(getChartTheme(false), {
      min: 0,
      max: 100,
    }));
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

    expect(new Set(colours.filter((colour) => colour.startsWith('rgb('))).size).toBe(10);
  });
});
