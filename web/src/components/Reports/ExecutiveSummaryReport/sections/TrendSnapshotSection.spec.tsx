import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { expectRendersNothing } from '../../../../test/renderNothing';
import { TrendSnapshotSection } from './TrendSnapshotSection';
import { loadedOverview } from './reportsOverview-fixtures';
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
    render(<TrendSnapshotSection {...loadedOverview()} />);

    expect(chartCaption(panel, sectionTitled(TITLE))).toBe(caption);
  });

  it('names the period and the window of the trend', () => {
    render(<TrendSnapshotSection {...loadedOverview({ period_type: 'week' })} />);

    expect(screen.getByText('The KPIs per week over the last 30 days, and each brand\'s share of voice in the latest periods.'))
      .toBeInTheDocument();
  });

  it('drops out of the report when no keyword has analysis data', () => {
    expectRendersNothing(<TrendSnapshotSection {...loadedOverview({ keywords_with_data: 0 })} />);
  });
});
