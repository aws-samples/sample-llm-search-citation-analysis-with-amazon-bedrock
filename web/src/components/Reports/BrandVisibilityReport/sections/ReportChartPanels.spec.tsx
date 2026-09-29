import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import { TrendPeriodChart } from './ReportChartPanels';
import {
  REPORT_CHART_PANELS, chartCaption
} from './reportChartPanels-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

describe('report chart panels', () => {
  it.each(REPORT_CHART_PANELS)('%s panel describes its chart in words', (title, panel, _info, caption) => {
    render(panel());

    expect(chartCaption(title)).toBe(caption);
  });

  it.each(REPORT_CHART_PANELS)('%s panel says what it draws under its title, where print keeps it', (title, panel, subtitle) => {
    render(panel());

    expect(within(screen.getByRole('region', { name: title })).getByText(subtitle)).toBeInTheDocument();
  });
});

describe('TrendPeriodChart', () => {
  it('says there is nothing to chart when the series has no period', () => {
    render(<TrendPeriodChart points={[]} />);

    expect(screen.getByText('No KPI history to chart yet.')).toBeInTheDocument();
  });
});
