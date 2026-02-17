import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordResearchView } from './KeywordResearchView';

vi.mock('../../hooks/useKeywordResearch', () => ({useKeywordResearch: vi.fn(),}));

vi.mock('./KeywordExpansion', () => ({KeywordExpansion: () => <div data-testid="keyword-expansion">Keyword Expansion</div>,}));

vi.mock('./CompetitorAnalysis', () => ({CompetitorAnalysis: () => <div data-testid="competitor-analysis">Competitor Analysis</div>,}));

vi.mock('./ResearchHistory', () => ({ResearchHistory: () => <div data-testid="research-history">Research History</div>,}));

import { useKeywordResearch } from '../../hooks/useKeywordResearch';

const mockUseKeywordResearch = useKeywordResearch as ReturnType<typeof vi.fn>;

function buildMockResearch(overrides = {}) {
  return {
    expandKeywords: vi.fn(),
    analyzeCompetitor: vi.fn(),
    deleteResearch: vi.fn(),
    fetchHistory: vi.fn(),
    loading: false,
    historyLoading: false,
    error: null,
    expansionResult: null,
    competitorResult: null,
    history: [],
    ...overrides,
  };
}

describe('KeywordResearchView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseKeywordResearch.mockReturnValue(buildMockResearch());
  });

  describe('tab navigation', () => {
    it('renders all three tab buttons', () => {
      render(<KeywordResearchView />);

      expect(screen.getByRole('button', { name: /related keywords/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /competitor analysis/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument();
    });

    it('shows keyword expansion tab by default', () => {
      render(<KeywordResearchView />);

      expect(screen.getByTestId('keyword-expansion')).toBeInTheDocument();
    });

    it('switches to competitor analysis tab when clicked', async () => {
      render(<KeywordResearchView />);

      await userEvent.click(screen.getByRole('button', { name: /competitor analysis/i }));

      expect(screen.getByTestId('competitor-analysis')).toBeInTheDocument();
    });

    it('switches to history tab when clicked', async () => {
      render(<KeywordResearchView />);

      await userEvent.click(screen.getByRole('button', { name: /history/i }));

      expect(screen.getByTestId('research-history')).toBeInTheDocument();
    });
  });

  describe('header', () => {
    it('displays description text', () => {
      render(<KeywordResearchView />);

      expect(screen.getByText(/discover keyword opportunities/i)).toBeInTheDocument();
    });
  });

  describe('active tab styling', () => {
    it('highlights the active tab', async () => {
      render(<KeywordResearchView />);

      const historyTab = screen.getByRole('button', { name: /history/i });
      await userEvent.click(historyTab);

      expect(historyTab).toHaveClass('border-gray-900');
    });
  });
});
