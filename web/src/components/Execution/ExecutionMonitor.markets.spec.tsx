import {
  screen, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  answerProvidersAndGroups, renderMarketMonitor
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
  it('runs every keyword without a scope when no market is ticked', async () => {
    const triggerAnalysis = renderMarketMonitor();

    await userEvent.click(await screen.findByRole('button', { name: /Start Analysis/u }));

    await waitFor(() => expect(triggerAnalysis).toHaveBeenCalledWith(undefined));
  });

  it.each([
    ['every keyword of the ticked market', 'Chile (Spanish)', /Start Analysis/u, {
      mode: 'all',
      market_ids: ['cl-es'],
    }],
    ['a whole group narrowed to the ticked market', 'No market', /^Hotel Sol\s*\(2\)$/u, {
      mode: 'groups',
      group_ids: ['g-sol'],
      market_ids: ['global'],
    }],
  ])('runs %s', async (_description, market, button, scope) => {
    const triggerAnalysis = renderMarketMonitor();

    await userEvent.click(await screen.findByRole('checkbox', { name: market }));
    await userEvent.click(await screen.findByRole('button', { name: button }));

    await waitFor(() => expect(triggerAnalysis).toHaveBeenCalledWith(scope));
  });

  it('counts and offers only the keywords of the ticked markets', async () => {
    renderMarketMonitor();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Chile (Spanish)' }));

    expect(screen.getByText('All 1 active keywords')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'hotels in santiago' })).not.toBeInTheDocument();
  });

  it('shows no market filter while no market is configured', async () => {
    renderMarketMonitor(false);

    await screen.findByRole('button', { name: /Start Analysis/u });

    expect(screen.queryByRole('group', { name: 'Markets' })).not.toBeInTheDocument();
  });
});
