import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchHistory } from './ResearchHistory';
import { SELECTION_LIMIT } from '../../hooks/usePromoteKeywords';
import type {
  ExpandedKeywordWithSource, KeywordResearchItem 
} from '../../types';

vi.mock('../../api/client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '../../api/client';

const mockApiPost = apiPost as ReturnType<typeof vi.fn>;

function buildHistoryItem(overrides: Partial<KeywordResearchItem> = {}): KeywordResearchItem {
  const defaults: KeywordResearchItem = {
    id: 'item-1',
    type: 'expansion',
    seed_keyword: 'hotels',
    industry: 'hospitality',
    keyword_count: 2,
    created_at: '2024-01-15T10:30:00Z',
    keywords: [
      {
        keyword: 'luxury hotels',
        intent: 'transactional',
        competition: 'high',
        relevance: 0.9 
      },
      {
        keyword: 'beach resorts',
        intent: 'transactional',
        competition: 'medium',
        relevance: 0.8 
      },
    ],
    ...overrides,
  };
  return defaults;
}

describe('ResearchHistory', () => {
  const defaultProps = {
    history: [],
    loading: false,
    onDelete: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('shows empty message when history is empty', () => {
      render(<ResearchHistory {...defaultProps} />);

      expect(screen.getByText(/no research history/i)).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading state when loading with no history', () => {
      render(<ResearchHistory {...defaultProps} loading={true} />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('with history items', () => {
    it('displays seed keyword from history item', () => {
      render(<ResearchHistory {...defaultProps} history={[buildHistoryItem()]} />);

      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('displays industry badge from history item', () => {
      render(<ResearchHistory {...defaultProps} history={[buildHistoryItem()]} />);

      expect(screen.getByText('hospitality')).toBeInTheDocument();
    });

    it('calls onDelete when delete button clicked', async () => {
      const onDelete = vi.fn();
      render(<ResearchHistory {...defaultProps} history={[buildHistoryItem()]} onDelete={onDelete} />);

      await userEvent.click(screen.getByRole('button', { name: /delete/i }));

      expect(onDelete).toHaveBeenCalledWith('item-1');
    });
  });

  describe('refresh', () => {
    it('calls onRefresh on mount', () => {
      const onRefresh = vi.fn();
      render(<ResearchHistory {...defaultProps} onRefresh={onRefresh} />);

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('calls onRefresh when refresh button clicked', async () => {
      const onRefresh = vi.fn();
      render(<ResearchHistory {...defaultProps} onRefresh={onRefresh} />);

      await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

      expect(onRefresh).toHaveBeenCalledTimes(2);
    });
  });
});

const luxuryHotelsFixture: ExpandedKeywordWithSource = {
  keyword: 'luxury hotels',
  intent: 'commercial',
  competition: 'high',
  relevance: 9,
  source: 'expansion',
};

const beachResortsFixture: ExpandedKeywordWithSource = {
  keyword: 'beach resorts',
  intent: 'informational',
  competition: 'low',
  relevance: 7,
  source: 'expansion',
};

const expansionHistoryKeywordFixtures = [luxuryHotelsFixture, beachResortsFixture];

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

const promotionWireFixture = {
  created: 1,
  skipped: 0,
  created_keywords: [{
    id: 'keyword-1',
    keyword: competitorPrimaryKeywordFixture.keyword,
  }],
  skipped_keywords: [],
};

const renderHistoryWithItems = (history: KeywordResearchItem[]) => render(
  <ResearchHistory
    history={history}
    loading={false}
    onDelete={vi.fn()}
    onRefresh={vi.fn()}
  />
);

const selectKeywordCheckbox = (keyword: string) =>
  screen.getByRole('checkbox', { name: `Select ${keyword}` });

describe('ResearchHistory promotion UI', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
  });

  it('renders one selection checkbox per keyword row of the expanded item', async () => {
    renderHistoryWithItems([buildHistoryItem({ keywords: expansionHistoryKeywordFixtures })]);

    await userEvent.click(screen.getByText('hotels'));

    expect(screen.getAllByRole('checkbox')).toHaveLength(expansionHistoryKeywordFixtures.length);
  });

  it('displays a selected count equal to the number of checked keywords', async () => {
    renderHistoryWithItems([buildHistoryItem({ keywords: expansionHistoryKeywordFixtures })]);
    await userEvent.click(screen.getByText('hotels'));

    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));

    expect(screen.getByText(`1 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
  });

  it('clears the selection when a different history item is expanded', async () => {
    renderHistoryWithItems([
      buildHistoryItem({ keywords: expansionHistoryKeywordFixtures }),
      buildHistoryItem({
        id: 'item-2',
        seed_keyword: 'flights',
        keywords: expansionHistoryKeywordFixtures,
      }),
    ]);
    await userEvent.click(screen.getByText('hotels'));
    await userEvent.click(selectKeywordCheckbox(luxuryHotelsFixture.keyword));
    expect(screen.getByText(`1 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();

    await userEvent.click(screen.getByText('flights'));
    await userEvent.click(screen.getByText('hotels'));

    expect(screen.getByText(`0 of ${SELECTION_LIMIT} keywords selected`)).toBeInTheDocument();
    expect(selectKeywordCheckbox(luxuryHotelsFixture.keyword)).not.toBeChecked();
  });

  it('sends a single request carrying the selected competitor keyword context on trigger', async () => {
    mockApiPost.mockResolvedValue(promotionWireFixture);
    renderHistoryWithItems([competitorHistoryItemFixture]);
    await userEvent.click(screen.getByText('example.com'));

    await userEvent.click(selectKeywordCheckbox(competitorPrimaryKeywordFixture.keyword));
    await userEvent.click(screen.getByRole('button', { name: /promote selected/i }));

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/keywords/promote',
      {
        keywords: [competitorPrimaryKeywordFixture],
        status: 'active',
        priority: 'normal',
      },
      { signal: expect.any(AbortSignal) }
    );
  });
});
