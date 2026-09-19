import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordResearchView } from './KeywordResearchView';
import { buildAgentJob } from './agent/agent-fixtures';
import type { KeywordResearchItem } from '../../types';

vi.mock('../../hooks/useKeywordResearch', () => ({useKeywordResearch: vi.fn(),}));

vi.mock('./KeywordExpansion', () => ({KeywordExpansion: () => <div data-testid="keyword-expansion">Keyword Expansion</div>,}));

vi.mock('./CompetitorAnalysis', () => ({CompetitorAnalysis: () => <div data-testid="competitor-analysis">Competitor Analysis</div>,}));

vi.mock('./ResearchHistory', () => ({
  ResearchHistory: ({ onRetry }: { onRetry: (job: KeywordResearchItem) => void }) => (
    <div data-testid="research-history">
      <button type="button" onClick={() => onRetry(buildAgentJob({ status: 'failed' }))}>Retry agent run</button>
    </div>
  ),
}));

vi.mock('./agent/ResearchAgent', () => ({ResearchAgent: () => <div data-testid="research-agent">Research Agent</div>,}));

import { useKeywordResearch } from '../../hooks/useKeywordResearch';

const mockUseKeywordResearch = useKeywordResearch as ReturnType<typeof vi.fn>;

function buildMockResearch(overrides = {}) {
  return {
    expandKeywords: vi.fn(),
    analyzeCompetitor: vi.fn(),
    deleteResearch: vi.fn(),
    fetchHistory: vi.fn(),
    retryResearch: vi.fn(),
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
    mockUseKeywordResearch.mockReturnValue(buildMockResearch());
  });

  describe('tab navigation', () => {
    it('orders the tabs with the research agent last', () => {
      render(<KeywordResearchView />);

      const tabs = within(screen.getByRole('navigation')).getAllByRole('button');
      expect(tabs.map((tab) => tab.textContent)).toStrictEqual([
        'Related KeywordsExpand',
        'Competitor AnalysisCompetitor',
        'HistoryHistory',
        'Research AgentAgent',
      ]);
    });

    it('shows related keywords by default', () => {
      render(<KeywordResearchView />);

      expect(screen.getByTestId('keyword-expansion')).toBeInTheDocument();
      expect(screen.queryByTestId('research-agent')).toBeNull();
    });

    it('switches to the research agent when its tab is clicked', async () => {
      render(<KeywordResearchView />);

      await userEvent.click(screen.getByRole('button', { name: /research agent/i }));

      expect(screen.getByTestId('research-agent')).toBeInTheDocument();
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

    it('jumps to the research agent tab when an agent run is retried from History', async () => {
      const research = buildMockResearch();
      mockUseKeywordResearch.mockReturnValue(research);
      render(<KeywordResearchView />);
      await userEvent.click(screen.getByRole('button', { name: /history/i }));

      await userEvent.click(screen.getByRole('button', { name: 'Retry agent run' }));

      expect(screen.getByTestId('research-agent')).toBeInTheDocument();
      expect(research.retryResearch).not.toHaveBeenCalled();
    });
  });

  describe('header', () => {
    it('describes the three ways to research, agent last', () => {
      render(<KeywordResearchView />);

      expect(screen.getByText('Expand seed terms, analyze competitor websites, or let the research agent plan and run a business\'s keyword research.')).toBeInTheDocument();
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
