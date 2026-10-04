import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { PromptInsights } from './PromptInsights';

vi.mock('../../hooks/usePromptInsights', () => ({usePromptInsights: vi.fn(),}));

import { usePromptInsights } from '../../hooks/usePromptInsights';
import {
  HOTELS_WINNING_PROMPT, buildPromptInsightsHookResult, buildPromptInsightsResponse 
} from './PromptInsights-fixtures';

const mockUsePromptInsights = vi.mocked(usePromptInsights);

/** Renders the view with the hook answering `overrides`; returns its `fetchPromptInsights` spy. */
function renderWithInsights(overrides: Parameters<typeof buildPromptInsightsHookResult>[0] = {}) {
  const hookResult = buildPromptInsightsHookResult(overrides);
  mockUsePromptInsights.mockReturnValue(hookResult);
  render(<PromptInsights />);
  return hookResult.fetchPromptInsights;
}

describe('PromptInsights', () => {
  beforeEach(() => {
    mockUsePromptInsights.mockReturnValue(buildPromptInsightsHookResult());
  });

  describe('initial render', () => {
    it('renders title', () => {
      renderWithInsights();

      expect(screen.getByText('Prompt Insights')).toBeInTheDocument();
    });

    it('renders the three tab buttons with zero counts when no data has loaded', () => {
      renderWithInsights();

      expect(screen.getAllByRole('button').map((tab) => tab.textContent)).toStrictEqual([
        'Winning (0)',
        'Losing (0)',
        'Opportunities (0)',
      ]);
    });

    it('fetches insights on mount', () => {
      const fetchPromptInsights = renderWithInsights();

      expect(fetchPromptInsights).toHaveBeenCalledWith('all', 20);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      renderWithInsights({ loading: true });

      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      renderWithInsights({ error: 'Failed to load insights' });

      expect(screen.getByText('Failed to load insights')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders prompt cards for winning prompts', () => {
      renderWithInsights({
        data: buildPromptInsightsResponse({
          winning_prompts: [HOTELS_WINNING_PROMPT],
          summary: {
            winning_count: 1,
            losing_count: 0,
            opportunity_count: 0,
            win_rate: 100,
          },
        }),
      });

      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('shows the winning, losing and opportunity counts of the summary', () => {
      renderWithInsights({
        data: buildPromptInsightsResponse({
          summary: {
            winning_count: 7,
            losing_count: 3,
            opportunity_count: 5,
            win_rate: 70,
          },
        }),
      });

      expect(screen.getByText('Winning').nextElementSibling).toHaveTextContent('7');
      expect(screen.getByText('Losing').nextElementSibling).toHaveTextContent('3');
      expect(screen.getByText('Opportunities').nextElementSibling).toHaveTextContent('5');
    });

    it('shows empty state when no prompts in active tab', () => {
      renderWithInsights({ data: buildPromptInsightsResponse() });

      expect(screen.getByText(/No winning prompts found/)).toBeInTheDocument();
    });
  });
});
