import {
  describe, it, expect, vi
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeywordResearchItem } from '../../types';
import { ResearchHistory } from './ResearchHistory';
import {
  buildFailedRun, buildHistoryItem
} from './ResearchHistory-fixtures';

vi.mock('../../api/client', () => import('./apiClientMock-fixtures'));

const renderHistory = (history: KeywordResearchItem[], onLoadMore?: () => void) => render(
  <ResearchHistory history={history} loading={false} onDelete={vi.fn()} onRefresh={vi.fn()} onLoadMore={onLoadMore} />
);

const getFilterChipElement = (group: string, name: RegExp) =>
  within(screen.getByRole('group', { name: group })).getByRole('button', { name });

const manyCompletedRuns = Array.from({ length: 25 }, (_, index) => buildHistoryItem({
  id: `run-${index}`,
  seed_keyword: `seed ${index}`,
  status: 'completed',
}));

const recentFailure = buildFailedRun('recent', 1, { seed_keyword: 'recent failure' });
const staleFailure = buildFailedRun('stale', 40, { seed_keyword: 'stale failure' });
const competitorRun = buildHistoryItem({
  id: 'competitor',
  type: 'competitor',
  domain: 'example.com',
  status: 'completed',
});
/** Enough runs for the type and status chips to show. */
const mixedHistory = [recentFailure, staleFailure, competitorRun, ...manyCompletedRuns.slice(0, 3)];


describe('ResearchHistory filters', () => {
  it('hides failed runs older than a week and says how many', () => {
    renderHistory(mixedHistory);

    expect(screen.getByText('recent failure')).toBeInTheDocument();
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
    expect(screen.getByText('1 failed run older than 7 days is hidden.')).toBeInTheDocument();
  });

  it('shows the hidden failures on request and hides them again', async () => {
    renderHistory(mixedHistory);

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 older failed run' }));
    expect(screen.getByText('stale failure')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide them' }));
    expect(screen.queryByText('stale failure')).not.toBeInTheDocument();
  });

  it('counts the runs each chip would show', () => {
    renderHistory(mixedHistory);

    expect(getFilterChipElement('Filter by type', /^All/)).toHaveTextContent('All 5');
    expect(getFilterChipElement('Filter by type', /^Competitor/)).toHaveTextContent('Competitor 1');
    expect(getFilterChipElement('Filter by status', /^Failed or partial/)).toHaveTextContent('Failed or partial 2');
  });

  it('lists every failure, however old, under the failed status', async () => {
    renderHistory(mixedHistory);

    await userEvent.click(getFilterChipElement('Filter by status', /^Failed or partial/));

    expect(screen.getByText('stale failure')).toBeInTheDocument();
    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    expect(getFilterChipElement('Filter by status', /^Failed or partial/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by run type', async () => {
    renderHistory(mixedHistory);

    await userEvent.click(getFilterChipElement('Filter by type', /^Competitor/));

    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.queryByText('recent failure')).not.toBeInTheDocument();
  });

  it('offers to clear filters that match nothing', async () => {
    renderHistory(mixedHistory);
    await userEvent.click(getFilterChipElement('Filter by status', /^Running/));

    expect(screen.getByText('No loaded runs match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByText('recent failure')).toBeInTheDocument();
  });

  it('hides the type filter when every run has the same type', () => {
    renderHistory(manyCompletedRuns);

    expect(screen.queryByRole('group', { name: 'Filter by type' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('shows no chips on a short list but still hides old failures', () => {
    renderHistory([recentFailure, staleFailure]);

    expect(screen.queryByRole('group', { name: 'Filter by status' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 1 older failed run' })).toBeInTheDocument();
  });
});

describe('ResearchHistory paging', () => {
  it('shows 20 rows, then the rest of the loaded runs before asking the API', async () => {
    const onLoadMore = vi.fn();
    renderHistory(manyCompletedRuns, onLoadMore);
    expect(screen.queryByText('seed 20')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(screen.getByText('seed 24')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Load older research' })).toBeEnabled();
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
