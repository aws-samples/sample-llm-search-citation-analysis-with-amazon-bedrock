import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { ResearchHistory } from './ResearchHistory';
import type {
  ExpandedKeywordWithSource, KeywordResearchItem
} from '../../types';
import { buildHistoryItem } from './ResearchHistory-fixtures';
import {
  buildCreatedKeywordItem,
  buildPromotionWire,
  expansionKeywordFixtures,
  luxuryHotelsFixture,
  promoteKeyword,
  promotionRequestArguments,
  selectKeywordCheckbox,
  selectionCountText,
} from './expandedKeyword-fixtures';
import {
  clickRetryButton, getRetryButtonElement, queryRetryButtonElement
} from './researchRetry-fixtures';

vi.mock('../../api/client', () => import('./apiClientMock-fixtures'));

import { mockApiPost } from './apiClientMock-fixtures';

const renderHistory = (overrides: Partial<ComponentProps<typeof ResearchHistory>> = {}) => render(
  <ResearchHistory history={[]} loading={false} onDelete={vi.fn()} onRefresh={vi.fn()} {...overrides} />
);

/** A finished run without steps or a failure message. */
const completedHistoryItem = buildHistoryItem({ status: 'completed' });

const renderHistoryWithItems = (history: KeywordResearchItem[]) => renderHistory({ history });

describe('ResearchHistory', () => {

  describe('empty state', () => {
    it('shows empty message when history is empty', () => {
      renderHistory();

      expect(screen.getByText(/no research history/i)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading state when loading with no history', () => {
      renderHistory({ loading: true });

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('with history items', () => {
    it('displays seed keyword from history item', () => {
      renderHistoryWithItems([buildHistoryItem()]);

      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('displays industry badge from history item', () => {
      renderHistoryWithItems([buildHistoryItem()]);

      expect(screen.getByText('hospitality')).toBeInTheDocument();
    });

    it('calls onDelete when delete button clicked', async () => {
      const onDelete = vi.fn();
      renderHistory({
        history: [buildHistoryItem()],
        onDelete,
      });

      await userEvent.click(screen.getByRole('button', { name: /delete/i }));

      expect(onDelete).toHaveBeenCalledWith('item-1');
    });
  });

  describe('refresh', () => {
    it('calls onRefresh on mount', () => {
      const onRefresh = vi.fn();
      renderHistory({ onRefresh });

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('calls onRefresh when refresh button clicked', async () => {
      const onRefresh = vi.fn();
      renderHistory({ onRefresh });

      await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

      expect(onRefresh).toHaveBeenCalledTimes(2);
    });
  });
});

const competitorPrimaryKeywordFixture: ExpandedKeywordWithSource = {
  keyword: 'boutique hotel barcelona',
  intent: 'commercial',
  competition: 'medium',
  relevance: 8,
  source: 'meta_description',
};

const competitorKeywordFixtures = [competitorPrimaryKeywordFixture];

const competitorHistoryItemFixture: KeywordResearchItem = {
  id: 'item-competitor',
  type: 'competitor',
  url: 'https://example.com',
  domain: 'example.com',
  industry: 'hospitality',
  keyword_count: competitorKeywordFixtures.length,
  created_at: '2024-01-16T10:30:00Z',
  analysis: { primary_keywords: competitorKeywordFixtures },
};

const createdKeywordItemFixture = buildCreatedKeywordItem({
  keyword: competitorPrimaryKeywordFixture.keyword,
  notes: 'intent: commercial; competition: medium; source: meta_description',
});

const promotionWireFixture = buildPromotionWire([createdKeywordItemFixture]);

/**
 * The five stranded production rows this covers were failed by the timeout
 * sweep long after they were queued, so the message carries a raw second count
 * (4434821 == 51 days).
 */
const strandedRunFixture: KeywordResearchItem = {
  id: 'item-stranded',
  type: 'expansion',
  seed_keyword: 'hotels',
  industry: 'hospitality',
  keyword_count: 0,
  created_at: '2026-06-29T10:30:00Z',
  status: 'failed',
  error_message: 'Research timed out after 4434821 seconds. Please try again.',
};

describe('ResearchHistory promotion UI', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  it('renders one selection checkbox per keyword row of the expanded item', async () => {
    renderHistoryWithItems([buildHistoryItem({ keywords: expansionKeywordFixtures })]);

    await userEvent.click(screen.getByText('hotels'));

    expect(screen.getAllByRole('checkbox')).toHaveLength(expansionKeywordFixtures.length);
  });

  it('clears the selection when a different history item is expanded', async () => {
    renderHistoryWithItems([
      buildHistoryItem({ keywords: expansionKeywordFixtures }),
      buildHistoryItem({
        id: 'item-2',
        seed_keyword: 'flights',
        keywords: expansionKeywordFixtures,
      }),
    ]);
    await userEvent.click(screen.getByText('hotels'));
    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    expect(screen.getByText(selectionCountText(1))).toBeInTheDocument();

    await userEvent.click(screen.getByText('flights'));
    await userEvent.click(screen.getByText('hotels'));

    expect(screen.getByText(selectionCountText(0))).toBeInTheDocument();
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).not.toBeChecked();
  });

  it('sends a single request carrying the selected competitor keyword context on trigger', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    renderHistoryWithItems([competitorHistoryItemFixture]);
    await userEvent.click(screen.getByText('example.com'));

    await promoteKeyword(competitorPrimaryKeywordFixture.keyword);

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(...promotionRequestArguments([competitorPrimaryKeywordFixture]));
  });

  it('reports the created keywords of the expanded item to its owner', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    const onKeywordsAdded = vi.fn();
    renderHistory({
      history: [competitorHistoryItemFixture],
      onKeywordsAdded,
    });
    await userEvent.click(screen.getByText('example.com'));

    await promoteKeyword(competitorPrimaryKeywordFixture.keyword);

    await waitFor(() => expect(onKeywordsAdded).toHaveBeenCalledTimes(1));
    expect(onKeywordsAdded).toHaveBeenCalledWith([createdKeywordItemFixture]);
  });
});

describe('ResearchHistory run status', () => {
  /**
   * Before this, a row the backend marked `failed` rendered identically to a
   * run that genuinely returned nothing: same "0 keywords", no reason given.
   */

  it('marks a failed run as failed', () => {
    renderHistoryWithItems([strandedRunFixture]);

    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('marks a queued run as queued', () => {
    renderHistoryWithItems([buildHistoryItem({ status: 'pending' })]);

    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('marks an in-flight run as running', () => {
    renderHistoryWithItems([buildHistoryItem({ status: 'processing' })]);

    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('marks a finished run as completed', () => {
    renderHistoryWithItems([completedHistoryItem]);

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows no status badge for a legacy row that has no status', () => {
    renderHistoryWithItems([buildHistoryItem({ status: undefined })]);

    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('distinguishes a failed run from a genuine empty result', () => {
    renderHistoryWithItems([
      strandedRunFixture,
      buildHistoryItem({
        id: 'item-empty',
        seed_keyword: 'flights',
        status: 'completed',
        keywords: [],
      }),
    ]);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});

describe('ResearchHistory failure message', () => {
  it('reports the failure reason on a failed run', () => {
    renderHistoryWithItems([strandedRunFixture]);

    expect(screen.getByText(/Research timed out/)).toBeInTheDocument();
  });

  it('states the timeout in days rather than raw seconds', () => {
    renderHistoryWithItems([strandedRunFixture]);

    expect(screen.getByText('Research timed out after 51 days. Please try again.')).toBeInTheDocument();
  });

  it('keeps the untranslated backend message available for debugging', () => {
    renderHistoryWithItems([strandedRunFixture]);

    expect(screen.getByText(/Research timed out/)).toHaveAttribute(
      'title',
      'Research timed out after 4434821 seconds. Please try again.'
    );
  });

  it('shows no failure message on a run that carries none', () => {
    renderHistoryWithItems([completedHistoryItem]);

    expect(screen.queryByText(/timed out/)).not.toBeInTheDocument();
  });
});


describe('ResearchHistory retry', () => {
  /**
   * 2.2.0: a job can end `partial` (some providers failed). The failed steps
   * can be re-run on their own, so partial and failed rows offer a retry and
   * completed rows do not.
   */
  const partialRun = buildHistoryItem({
    id: 'partial-1',
    status: 'partial',
    steps_total: 3,
    steps_done: 3,
    steps_failed: 1,
  });

  it('marks a partially successful run as partial', () => {
    renderHistoryWithItems([partialRun]);

    expect(screen.getByText('Partial')).toBeInTheDocument();
  });

  it('shows how many providers finished and how many failed', () => {
    renderHistoryWithItems([partialRun]);

    expect(screen.getByText(/3\/3 providers/)).toBeInTheDocument();
    expect(screen.getByText('(1 failed)')).toBeInTheDocument();
  });

  it('shows no provider summary for a legacy row without steps', () => {
    renderHistoryWithItems([completedHistoryItem]);

    expect(screen.queryByText(/providers/)).not.toBeInTheDocument();
  });

  it('offers a retry on a partial run and hands back the job', async () => {
    const onRetry = vi.fn();
    renderHistory({
      history: [partialRun],
      onRetry,
    });

    await clickRetryButton();

    expect(onRetry).toHaveBeenCalledWith(partialRun);
  });

  it('offers a retry on a failed run', () => {
    renderHistory({
      history: [strandedRunFixture],
      onRetry: vi.fn(),
    });

    expect(getRetryButtonElement()).toBeInTheDocument();
  });

  it('offers no retry on a completed run', () => {
    renderHistory({
      history: [completedHistoryItem],
      onRetry: vi.fn(),
    });

    expect(queryRetryButtonElement()).not.toBeInTheDocument();
  });

  it('offers no retry when the caller cannot retry', () => {
    renderHistoryWithItems([partialRun]);

    expect(queryRetryButtonElement()).not.toBeInTheDocument();
  });
});
