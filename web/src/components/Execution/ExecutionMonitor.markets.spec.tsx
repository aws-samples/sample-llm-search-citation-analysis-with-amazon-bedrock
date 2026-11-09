import {
  screen, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  answerProvidersAndGroups, pressStart, renderMarketMonitor, tickMarkets
} from './ExecutionMonitor-fixtures';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../hooks/useIsAdmin', () => ({
  useIsAdmin: () => ({
    isAdmin: true,
    loading: false,
  }),
}));

beforeEach(answerProvidersAndGroups);

describe('ExecutionMonitor market filter', () => {
  it.each([
    ['every keyword without a scope when no market is ticked', [], undefined],
    ['every keyword of the ticked market', ['Chile (Spanish)'], {
      mode: 'all',
      market_ids: ['cl-es'],
    }],
  ])('runs %s', async (_case, markets, scope) => {
    const triggerAnalysis = renderMarketMonitor();

    await tickMarkets(...markets);
    await pressStart();

    await waitFor(() => expect(triggerAnalysis).toHaveBeenCalledWith(scope));
  });

  it('keeps the market filter collapsed until asked for', async () => {
    renderMarketMonitor();

    const toggle = await screen.findByRole('button', { name: /Limit to markets/u });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/2 active keywords in every market/u)).toBeInTheDocument();
  });

  /**
   * REGRESSION: a group button started a paid run on the first click, with
   * nothing on screen saying it would. A group is now one choice among the
   * others, and only Start runs it.
   */
  it('runs a picked group narrowed to the ticked market only when Start is pressed', async () => {
    const triggerAnalysis = renderMarketMonitor();

    await userEvent.click(await screen.findByRole('radio', { name: /Keyword groups/u }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include group Hotel Sol' }));
    await tickMarkets('No market');

    expect(triggerAnalysis).not.toHaveBeenCalled();

    await pressStart();

    await waitFor(() => expect(triggerAnalysis).toHaveBeenCalledWith({
      mode: 'groups',
      group_ids: ['g-sol'],
      market_ids: ['global'],
    }));
  });

  it('counts and offers only the keywords of the ticked markets', async () => {
    renderMarketMonitor();

    await tickMarkets('Chile (Spanish)');

    expect(screen.getByText(/1 active keyword in Chile \(Spanish\)/u)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Specific keywords/u }));

    expect(screen.queryByRole('checkbox', { name: 'hotels in santiago' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'hoteles en santiago' })).toBeInTheDocument();
  });

  it('shows no market filter while no market is configured', async () => {
    renderMarketMonitor(false);

    await screen.findByRole('button', { name: /Start analysis/u });

    expect(screen.queryByRole('button', { name: /Limit to markets/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Markets' })).not.toBeInTheDocument();
  });
});
