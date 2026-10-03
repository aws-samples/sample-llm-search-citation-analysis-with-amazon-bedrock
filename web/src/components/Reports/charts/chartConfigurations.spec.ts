import {
  describe, expect, it
} from 'vitest';
import {
  themedAxis, themedLegend, themedTooltip
} from '../../ui/chartTheme';
import {
  CHART_KINDS, EMPTY_CHART_DATA, LIGHT_CONFIGURATIONS, LIGHT_THEME, PERCENT_AXES, STACKED_ROW_AXES
} from './charts-fixtures';

describe('every report chart configuration', () => {
  it.each(CHART_KINDS)('%s draws a %s chart indexed along %s', (_name, buildChart, type, indexAxis) => {
    const chart = buildChart();

    expect([chart.type, chart.options?.indexAxis]).toStrictEqual([type, indexAxis]);
  });

  it.each(EMPTY_CHART_DATA)('%s draws nothing without data', (_name, buildData) => {
    expect(buildData()).toStrictEqual({
      labels: [],
      datasets: [],
    });
  });

  it.each(STACKED_ROW_AXES)('%s stacks the values of a row in one bar', (_name, buildAxis) => {
    expect(buildAxis()).toStrictEqual(themedAxis(LIGHT_THEME, { stacked: true }));
  });

  it.each(LIGHT_CONFIGURATIONS)('%s is responsive and fills its fixed-height box', (_name, buildChart) => {
    const chart = buildChart();

    expect([chart.options?.responsive, chart.options?.maintainAspectRatio]).toStrictEqual([true, false]);
  });

  it.each(LIGHT_CONFIGURATIONS)('%s uses the themed legend', (_name, buildChart) => {
    expect(buildChart().options?.plugins?.legend).toStrictEqual(themedLegend(LIGHT_THEME));
  });

  it.each(LIGHT_CONFIGURATIONS)('%s uses the themed tooltip colours', (_name, buildChart) => {
    expect(buildChart().options?.plugins?.tooltip).toMatchObject(themedTooltip(LIGHT_THEME));
  });

  it.each(PERCENT_AXES)('%s draws values on a themed 0-100 axis', (_name, buildAxis) => {
    expect(buildAxis()).toStrictEqual(themedAxis(LIGHT_THEME, {
      min: 0,
      max: 100,
    }));
  });
});
