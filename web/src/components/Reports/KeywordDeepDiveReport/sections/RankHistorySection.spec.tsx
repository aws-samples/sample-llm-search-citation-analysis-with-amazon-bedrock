import {
  describe, it, expect, vi,
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { RankHistorySection } from './RankHistorySection';
import {
  buildTrendPoints, buildTrendView
} from '../../layout/reportPayload-fixtures';
import {
  sectionTable, sectionTitled
} from '../../layout/reportQueries-fixtures';
import {
  TREND_VIEW_KPI_CAPTION, chartCaption
} from '../../BrandVisibilityReport/sections/reportChartPanels-fixtures';
import { KPI_TREND_TITLE } from '../../BrandVisibilityReport/sections/ReportChartPanels';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

const EMPTY = 'No history yet — run an analysis of this keyword to start one.';

describe('RankHistorySection — chart', () => {
  it('charts the keyword KPIs of every period above the table', () => {
    render(<RankHistorySection trends={buildTrendView()} loading={false} error={null} />);

    expect(chartCaption(KPI_TREND_TITLE, sectionTitled('KPI history'))).toBe(TREND_VIEW_KPI_CAPTION);
  });
});

describe('RankHistorySection — table', () => {
  it('lists every period of the keyword with its runs and KPIs', () => {
    render(<RankHistorySection trends={buildTrendView({ trend_data: buildTrendPoints(2) })} loading={false} error={null} />);

    expect(sectionTable('KPI history').slice(1)).toStrictEqual([
      ['d-00', '2', '20', '60.0%', '25.0%', '40.0', '1.80', '30.0%'],
      ['d-01', '2', '20', '60.0%', '25.0%', '41.0', '1.80', '30.0%'],
    ]);
  });

  it('says over which periods and days the KPIs moved', () => {
    render(<RankHistorySection trends={buildTrendView({ period_type: 'week' })} loading={false} error={null} />);

    expect(screen.getByText('How this keyword\'s KPIs moved per week over the last 30 days.')).toBeInTheDocument();
  });

  it('samples a long history to the printable number of rows, keeping the first and last period', () => {
    render(<RankHistorySection trends={buildTrendView({ trend_data: buildTrendPoints(30) })} loading={false} error={null} />);

    const periods = sectionTable('KPI history').slice(1).map(([period]) => period);
    expect([periods.length, periods[0], periods[periods.length - 1]]).toStrictEqual([14, 'd-00', 'd-29']);
  });
});

describe('RankHistorySection — placeholder states', () => {
  it.each([
    ['the trend holds no period', buildTrendView({ trend_data: [] })],
    ['there is no trend answer', null],
  ])('says there is no history yet when %s', (_label, trends) => {
    render(<RankHistorySection trends={trends} loading={false} error={null} />);

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it('renders loading state when loading is true', () => {
    render(<RankHistorySection trends={null} loading error={null} />);

    expect(screen.getByText('Loading trend data…')).toBeInTheDocument();
  });

  it('describes the default 30-day window while loading', () => {
    render(<RankHistorySection trends={null} loading error={null} />);

    expect(screen.getByText('How this keyword\'s KPIs moved per day over the last 30 days.')).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    render(<RankHistorySection trends={null} loading={false} error="Network blew up" />);

    expect(screen.getByText('Network blew up')).toBeInTheDocument();
  });
});
