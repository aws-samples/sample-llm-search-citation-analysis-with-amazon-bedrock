import type { ComponentProps } from 'react';
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

/** The section loaded with `buildTrendView()`, unless `props` say otherwise. */
function renderRankHistory(props: Partial<ComponentProps<typeof RankHistorySection>> = {}) {
  render(<RankHistorySection trends={buildTrendView()} loading={false} error={null} {...props} />);
}

describe('RankHistorySection — chart', () => {
  it('charts the keyword KPIs of every period above the table', () => {
    renderRankHistory();

    expect(chartCaption(KPI_TREND_TITLE, sectionTitled('KPI history'))).toBe(TREND_VIEW_KPI_CAPTION);
  });
});

describe('RankHistorySection — table', () => {
  it('lists every period of the keyword with its runs and KPIs', () => {
    renderRankHistory({ trends: buildTrendView({ trend_data: buildTrendPoints(2) }) });

    expect(sectionTable('KPI history').slice(1)).toStrictEqual([
      ['d-00', '2', '20', '60.0%', '25.0%', '40.0', '1.80', '30.0%'],
      ['d-01', '2', '20', '60.0%', '25.0%', '41.0', '1.80', '30.0%'],
    ]);
  });

  it('says over which periods and days the KPIs moved', () => {
    renderRankHistory({ trends: buildTrendView({ period_type: 'week' }) });

    expect(screen.getByText('How this keyword\'s KPIs moved per week over the last 30 days.')).toBeInTheDocument();
  });

  it('samples a long history to the printable number of rows, keeping the first and last period', () => {
    renderRankHistory({ trends: buildTrendView({ trend_data: buildTrendPoints(30) }) });

    const periods = sectionTable('KPI history').slice(1).map(([period]) => period);
    expect([periods.length, periods[0], periods[periods.length - 1]]).toStrictEqual([14, 'd-00', 'd-29']);
  });
});

describe('RankHistorySection — placeholder states', () => {
  it.each([
    ['the trend holds no period', buildTrendView({ trend_data: [] })],
    ['there is no trend answer', null],
  ])('says there is no history yet when %s', (_label, trends) => {
    renderRankHistory({ trends });

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
  });

  it.each([
    ['shows the loading state', 'Loading trend data…'],
    ['describes the default 30-day window', 'How this keyword\'s KPIs moved per day over the last 30 days.'],
  ])('%s while loading', (_outcome, text) => {
    renderRankHistory({
      trends: null,
      loading: true,
    });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders error message when error is set', () => {
    renderRankHistory({
      trends: null,
      error: 'Network blew up',
    });

    expect(screen.getByText('Network blew up')).toBeInTheDocument();
  });
});
