import type { ComponentProps } from 'react';
import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  HISTORY_TITLE, VisibilityHistory
} from './VisibilityHistory';
import {
  GROUP_TREND_CAPTION, TRENDS_WITH_GAP, buildDailyTrendPoints, buildTrendsResponse
} from './visibilityOverview-fixtures';
import {
  aboutButton, clickRangeButton, historyPanel
} from './visibilityTables-fixtures';
import { KPI_TREND_INFO } from '../Reports/BrandVisibilityReport/sections/ReportChartPanels';
import { formatDateOnly } from '../../formatting/dateFormatter';

vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));

const NO_RUNS = 'No analysis runs in this range yet.';

type HistoryProps = Partial<ComponentProps<typeof VisibilityHistory>>;

/** The history of the group's 30-day trends over the 30-day range, without an error, unless overridden. */
function renderHistory(overrides: HistoryProps = {}) {
  return render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} {...overrides} />);
}

describe('VisibilityHistory', () => {
  it('explains the charted KPIs and their scale in the tooltip', () => {
    renderHistory();

    expect(aboutButton(HISTORY_TITLE)).toHaveAccessibleDescription(KPI_TREND_INFO);
  });

  it.each([
    ['charts the headline KPIs of every period as lines', buildTrendsResponse(), GROUP_TREND_CAPTION],
    ['charts every period of the range, not a sample', buildTrendsResponse({ trend_data: buildDailyTrendPoints(20) }), 'over 20 periods from 2026-09-01 to 2026-09-20'],
    ['leaves a period without a score as a gap, not a zero', TRENDS_WITH_GAP, 'Visibility score —, Citation rate 30.0%.'],
  ])('%s', (_outcome, trends, caption) => {
    renderHistory({ trends });

    expect(historyPanel().getByRole('figure')).toHaveTextContent(caption);
  });

  it('names the KPIs, period, range and start date under the chart', () => {
    renderHistory({
      trends: buildTrendsResponse({ period_type: 'week' }),
      rangeDays: 90,
    });

    expect(historyPanel().getByText(
      'Mention rate, share of voice, visibility score and citation rate per week over the last 30 days '
        + `(since ${formatDateOnly('2026-08-16')}). A week without answers is a gap.`
    )).toBeInTheDocument();
  });

  it.each<[string, HistoryProps, string]>([
    ['says there are no runs in the range, without a chart, when trends are not loaded', {
      trends: null,
      rangeDays: 7,
    }, NO_RUNS],
    ['says there are no runs in the range, without a chart, when the range has no period', {
      trends: buildTrendsResponse({ trend_data: [] }),
      rangeDays: 7,
    }, NO_RUNS],
    ['reports why the history could not be loaded, without a chart', { error: 'Failed to load visibility metrics' }, 'History unavailable: Failed to load visibility metrics'],
  ])('%s', (_outcome, overrides, text) => {
    renderHistory(overrides);

    expect(historyPanel().getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it.each([
    [7, ['true', 'false', 'false']],
    [30, ['false', 'true', 'false']],
    [90, ['false', 'false', 'true']],
  ] as const)('marks only the %s-day range as pressed', (rangeDays, pressed) => {
    renderHistory({
      trends: null,
      rangeDays,
    });

    const buttons = ['7 days', '30 days', '90 days'].map((name) => screen.getByRole('button', { name }));

    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toStrictEqual(pressed);
  });

  it.each([7, 30, 90])('asks for the %s-day range when its button is clicked', async (days) => {
    const onRangeChange = vi.fn();
    renderHistory({
      trends: null,
      onRangeChange,
    });

    await clickRangeButton(days);

    expect(onRangeChange).toHaveBeenCalledWith(days);
  });
});
