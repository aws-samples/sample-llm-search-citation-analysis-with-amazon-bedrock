import {
  describe, expect, it
} from 'vitest';
import {
  getChartTheme, themedAxis, themedLegend, themedTooltip
} from './chartTheme';

const DARK = getChartTheme(true);

describe('themedAxis', () => {
  it('colours ticks and grid from the theme', () => {
    expect(themedAxis(DARK)).toStrictEqual({
      ticks: { color: DARK.textColor },
      grid: { color: DARK.gridColor },
    });
  });

  it('keeps the theme tick colour when the caller adds tick options', () => {
    expect(themedAxis(DARK, { ticks: { stepSize: 1 } }).ticks).toStrictEqual({
      color: DARK.textColor,
      stepSize: 1,
    });
  });

  it('passes other axis options through', () => {
    expect(themedAxis(DARK, {
      min: 0,
      stacked: true 
    })).toStrictEqual({
      min: 0,
      stacked: true,
      ticks: { color: DARK.textColor },
      grid: { color: DARK.gridColor },
    });
  });
});


describe('getChartTheme', () => {
  it('uses light chrome on dark backgrounds', () => {
    expect(getChartTheme(true)).toStrictEqual({
      textColor: 'rgb(209, 213, 219)',
      gridColor: 'rgba(255, 255, 255, 0.08)',
      tooltipBackground: 'rgba(31, 41, 55, 0.95)',
      tooltipBorder: 'rgba(75, 85, 99, 1)',
      tooltipText: 'rgb(243, 244, 246)',
    });
  });

  it('uses dark chrome on light backgrounds', () => {
    expect(getChartTheme(false)).toStrictEqual({
      textColor: 'rgb(75, 85, 99)',
      gridColor: 'rgba(0, 0, 0, 0.05)',
      tooltipBackground: 'rgba(17, 24, 39, 0.92)',
      tooltipBorder: 'rgba(75, 85, 99, 1)',
      tooltipText: 'rgb(249, 250, 251)',
    });
  });
});

describe('themedLegend', () => {
  it('shows the legend under the chart in the theme text colour', () => {
    expect(themedLegend(DARK)).toStrictEqual({
      display: true,
      position: 'bottom',
      labels: { color: DARK.textColor },
    });
  });
});

describe('themedTooltip', () => {
  it('paints the tooltip in the theme colours', () => {
    expect(themedTooltip(DARK)).toStrictEqual({
      backgroundColor: DARK.tooltipBackground,
      borderColor: DARK.tooltipBorder,
      borderWidth: 1,
      titleColor: DARK.tooltipText,
      bodyColor: DARK.tooltipText,
    });
  });
});
