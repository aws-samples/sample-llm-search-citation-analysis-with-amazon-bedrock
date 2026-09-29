import {
  describe, expect, it
} from 'vitest';
import {
  themedAxis, themedLegend, themedTooltip
} from '../../ui/chartTheme';
import {
  LIGHT_CONFIGURATIONS, LIGHT_THEME, PERCENT_AXES
} from './charts-fixtures';

describe('every report chart configuration', () => {
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
