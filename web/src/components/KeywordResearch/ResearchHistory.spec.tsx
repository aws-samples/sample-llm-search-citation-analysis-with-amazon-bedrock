import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchHistory } from './ResearchHistory';
import type { KeywordResearchItem } from '../../types';

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
