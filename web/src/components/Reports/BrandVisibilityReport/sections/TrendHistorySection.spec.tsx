import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { TrendHistorySection } from './TrendHistorySection';
import {
  buildTrendView, LATEST_PERIOD, PREVIOUS_PERIOD
} from '../../layout/reportPayload-fixtures';
import {
  sectionTable, sectionTitled
} from '../../layout/reportQueries-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';
import { RUN_1 } from '../groupKpiHistory-fixtures';
import {
  TREND_VIEW_KPI_CAPTION, trendHistoryKpiCaption
} from './reportChartPanels-fixtures';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

describe('TrendHistorySection', () => {
  describe('over two days', () => {
    beforeEach(() => {
      render(<TrendHistorySection {...settledTrends(buildTrendView())} />);
    });

    it('charts the KPIs of every period above the table', () => {
      expect(trendHistoryKpiCaption()).toBe(TREND_VIEW_KPI_CAPTION);
    });

    it('starts the history on a new printed page', () => {
      expect(sectionTitled('Trend history')).toHaveClass('page-break-before');
    });

    it('lists every period of the trend, oldest first', () => {
      expect(sectionTable('Trend history').slice(1).map(([period]) => period)).toStrictEqual([PREVIOUS_PERIOD, LATEST_PERIOD]);
    });
  });

  it('says the KPIs are per period of the window, from its first day', () => {
    render(<TrendHistorySection {...settledTrends(buildTrendView({ period_type: 'week' }))} />);

    expect(screen.getByText(`Every KPI per week since ${new Date(RUN_1).toLocaleDateString()}, over every answer in the week.`))
      .toBeInTheDocument();
  });
});
