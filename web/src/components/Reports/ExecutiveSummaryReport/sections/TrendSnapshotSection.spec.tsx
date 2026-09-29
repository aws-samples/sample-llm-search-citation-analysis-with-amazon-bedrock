import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { TrendSnapshotSection } from './TrendSnapshotSection';
import { buildOverview } from '../../layout/reportPayload-fixtures';
import { sectionTitled } from '../../layout/reportQueries-fixtures';
import {
  LATEST_BRANDS_SOV_CAPTION, TREND_VIEW_KPI_CAPTION, chartCaption
} from '../../BrandVisibilityReport/sections/reportChartPanels-fixtures';
import {
  KPI_TREND_TITLE, SHARE_OF_VOICE_TITLE
} from '../../BrandVisibilityReport/sections/ReportChartPanels';

vi.mock('chart.js', () => import('../../../Dashboard/chartJs-fixtures'));

const TITLE = 'Trend and share of voice';

describe('TrendSnapshotSection', () => {
  it.each([
    [KPI_TREND_TITLE, TREND_VIEW_KPI_CAPTION],
    [SHARE_OF_VOICE_TITLE, LATEST_BRANDS_SOV_CAPTION],
  ])('charts the %s of the overview', (panel, caption) => {
    render(<TrendSnapshotSection data={buildOverview()} loading={false} error={null} />);

    expect(chartCaption(panel, sectionTitled(TITLE))).toBe(caption);
  });

  it('names the period and the window of the trend', () => {
    render(<TrendSnapshotSection data={buildOverview({ period_type: 'week' })} loading={false} error={null} />);

    expect(screen.getByText('The KPIs per week over the last 30 days, and each brand\'s share of voice in the latest periods.'))
      .toBeInTheDocument();
  });

  it('drops out of the report when no keyword has analysis data', () => {
    expectRendersNothing(<TrendSnapshotSection data={buildOverview({ keywords_with_data: 0 })} loading={false} error={null} />);
  });

  it('shows the loading state under the section title', () => {
    render(<TrendSnapshotSection data={null} loading error={null} />);

    expect(sectionTitled(TITLE)).toHaveTextContent('Loading the KPI trend…');
  });

  it('shows the error', () => {
    render(<TrendSnapshotSection data={null} loading={false} error="Network down" />);

    expect(screen.getByText('Network down')).toBeInTheDocument();
  });
});
