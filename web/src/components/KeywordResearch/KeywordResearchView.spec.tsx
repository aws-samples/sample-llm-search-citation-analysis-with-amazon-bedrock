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

      const tabs = within(screen.getByRole('tablist', { name: 'Keyword research' })).getAllByRole('tab');
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

    it.each([
      {
        outcome: 'switches to the research agent when its tab is clicked',
        tab: /research agent/i,
        view: 'research-agent',
      },
      {
        outcome: 'switches to competitor analysis tab when clicked',
        tab: /competitor analysis/i,
        view: 'competitor-analysis',
      },
      {
        outcome: 'switches to history tab when clicked',
        tab: /history/i,
        view: 'research-history',
      },
    ])('$outcome', async ({
      tab, view
    }) => {
      render(<KeywordResearchView />);

      await userEvent.click(screen.getByRole('tab', { name: tab }));

      expect(screen.getByTestId(view)).toBeInTheDocument();
    });

    it('jumps to the research agent tab when an agent run is retried from History', async () => {
      const research = buildMockResearch();
      mockUseKeywordResearch.mockReturnValue(research);
      render(<KeywordResearchView />);
      await userEvent.click(screen.getByRole('tab', { name: /history/i }));

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

  describe('active tab', () => {
    it('marks the clicked tab as the selected one', async () => {
      render(<KeywordResearchView />);

      const historyTab = screen.getByRole('tab', { name: /history/i });
      await userEvent.click(historyTab);

      expect(historyTab).toHaveAttribute('aria-selected', 'true');
    });
  });
});
