import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityHistory } from './VisibilityHistory';
import {
  TRENDS_WITH_GAP, buildTrendsResponse
} from './visibilityOverview-fixtures';
import { panelTitled } from './visibilityTables-fixtures';
import { KPI_DEFINITIONS } from '../../constants/kpiDefinitions';
import { formatDateOnly } from '../../formatting/dateFormatter';

const HISTORY = 'Visibility score history';

describe('VisibilityHistory', () => {
  it('explains the charted visibility score with its KPI definition', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY)).getByRole('button', { name: `About ${HISTORY}` }))
      .toHaveAccessibleDescription(KPI_DEFINITIONS.visibility_score.definition);
  });

  it('describes every period with its score, runs and keywords', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    const bars = within(screen.getByRole('list', { name: 'Visibility score per day' })).getAllByRole('listitem');

    expect(bars.map((bar) => bar.querySelector('.sr-only')?.textContent)).toStrictEqual([
      '2026-09-01: 60.6 (2 runs, 2 keywords)',
      '2026-09-08: 52.4 (1 run, 1 keyword)',
    ]);
  });

  it('draws a bar as high as its score out of 100', () => {
    render(<VisibilityHistory trends={TRENDS_WITH_GAP} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    expect(screen.getByTitle('2026-09-01: 50.0 (2 runs, 2 keywords)')).toHaveStyle({ height: '90px' });
  });

  it('leaves a gap, not a zero bar, for a period without a score', () => {
    render(<VisibilityHistory trends={TRENDS_WITH_GAP} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    const gap = screen.getByTitle('2026-09-08: — (1 run, 1 keyword)');

    expect(gap).not.toHaveAttribute('style');
    expect(gap).not.toHaveClass('bg-blue-500');
  });

  it('labels the first of every five periods under its bar', () => {
    render(<VisibilityHistory trends={buildTrendsResponse()} error={null} rangeDays={30} onRangeChange={vi.fn()} />);

    const [first, second] = within(screen.getByRole('list', { name: 'Visibility score per day' })).getAllByRole('listitem');

    expect(within(first).getByText('09-01')).toBeInTheDocument();
    expect(within(second).queryByText('09-08')).not.toBeInTheDocument();
  });

  it('names the period, range and start date under the chart', () => {
    render(<VisibilityHistory trends={buildTrendsResponse({ period_type: 'week' })} error={null} rangeDays={90} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY)).getByText(
      `Visibility score per week over the last 30 days (since ${formatDateOnly('2026-08-16')}). A week without answers is a gap.`
    )).toBeInTheDocument();
  });

  it.each([
    ['trends are not loaded', null],
    ['the range has no period', buildTrendsResponse({ trend_data: [] })],
  ])('says there are no runs in the range when %s', (_condition, trends) => {
    render(<VisibilityHistory trends={trends} error={null} rangeDays={7} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY)).getByText('No analysis runs in this range yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('reports why the history could not be loaded', () => {
    render(<VisibilityHistory trends={null} error="Failed to load visibility metrics" rangeDays={30} onRangeChange={vi.fn()} />);

    expect(within(panelTitled(HISTORY)).getByText('History unavailable: Failed to load visibility metrics')).toBeInTheDocument();
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
