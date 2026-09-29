import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  HISTORY_TITLE, VisibilityHistory
} from './VisibilityHistory';
import {
  GROUP_TREND_CAPTION, TRENDS_WITH_GAP, buildDailyTrendPoints, buildTrendsResponse
} from './visibilityOverview-fixtures';
import { panelTitled } from './visibilityTables-fixtures';
import { KPI_TREND_INFO } from '../Reports/BrandVisibilityReport/sections/ReportChartPanels';
import { formatDateOnly } from '../../formatting/dateFormatter';

vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));

describe('VisibilityHistory', () => {
  it('explains the charted KPIs and their scale in the tooltip', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByRole('button', { name: `About ${HISTORY_TITLE}` }))
      .toHaveAccessibleDescription(KPI_TREND_INFO);
  });

  it('charts the headline KPIs of every period as lines', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByRole('figure')).toHaveTextContent(GROUP_TREND_CAPTION);
  });

  it('charts every period of the range, not a sample', () => {
    render(<VisibilityHistory trends={buildTrendsResponse({ trend_data: buildDailyTrendPoints(20) })} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByRole('figure')).toHaveTextContent('over 20 periods from 2026-09-01 to 2026-09-20');
  });

  it('leaves a period without a score as a gap, not a zero', () => {
    render(<VisibilityHistory trends={TRENDS_WITH_GAP} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByRole('figure')).toHaveTextContent('Visibility score —, Citation rate 30.0%.');
  });

  it('names the KPIs, period, range and start date under the chart', () => {
    render(<VisibilityHistory trends={buildTrendsResponse({ period_type: 'week' })} error={null} rangeDays={90} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByText(
      'Mention rate, share of voice, visibility score and citation rate per week over the last 30 days '
        + `(since ${formatDateOnly('2026-08-16')}). A week without answers is a gap.`
    )).toBeInTheDocument();
  });

  it.each([
    ['trends are not loaded', null],
    ['the range has no period', buildTrendsResponse({ trend_data: [] })],
  ])('says there are no runs in the range, without a chart, when %s', (_condition, trends) => {
    render(<VisibilityHistory trends={trends} error={null} rangeDays={7} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByText('No analysis runs in this range yet.')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it('reports why the history could not be loaded, without a chart', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error="Failed to load visibility metrics" rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY_TITLE)).getByText('History unavailable: Failed to load visibility metrics')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
  });

  it.each([
    [7, ['true', 'false', 'false']],
    [30, ['false', 'true', 'false']],
    [90, ['false', 'false', 'true']],
  ] as const)('marks only the %s-day range as pressed', (rangeDays, pressed) => {
    render(<VisibilityHistory trends={null} error={null} rangeDays={rangeDays} onRangeChange={vi.fn()} />);

    const buttons = ['7 days', '30 days', '90 days'].map((name) => screen.getByRole('button', { name }));

    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toStrictEqual(pressed);
  });

  it.each([7, 30, 90])('asks for the %s-day range when its button is clicked', async (days) => {
    const onRangeChange = vi.fn();
    render(<VisibilityHistory trends={null} error={null} rangeDays={30} onRangeChange={onRangeChange} />);

    await userEvent.click(screen.getByRole('button', { name: `${days} days` }));

    expect(onRangeChange).toHaveBeenCalledWith(days);
  });
});
