import {
  describe, it, expect, vi 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { PromptInsights } from './PromptInsights';

vi.mock('../../hooks/usePromptInsights', () => ({usePromptInsights: vi.fn(),}));
vi.mock('../../hooks/useKeywordGroups');

import { usePromptInsights } from '../../hooks/usePromptInsights';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import {
  describeScopeSelection, mockCorunaKeywordGroups, neverSettlingFetch
} from './useScopeSelection-fixtures';
import {
  WINNING_HOTELS_RESPONSE, buildPromptInsightsHookResult, buildPromptInsightsResponse 
} from './PromptInsights-fixtures';

const mockUsePromptInsights = vi.mocked(usePromptInsights);

/** Renders the view with the hook answering `overrides`; returns its `fetchPromptInsights` spy. */
function renderWithInsights(overrides: Parameters<typeof buildPromptInsightsHookResult>[0] = {}) {
  const hookResult = buildPromptInsightsHookResult(overrides);
  mockUsePromptInsights.mockReturnValue(hookResult);
  mockCorunaKeywordGroups();
  render(<PromptInsights keywords={SCOPE_KEYWORDS} />);
  return hookResult.fetchPromptInsights;
}

describe('PromptInsights', () => {
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
      renderWithInsights({ data: WINNING_HOTELS_RESPONSE });

      expect(screen.getByRole('heading', { name: 'hotels' })).toBeInTheDocument();
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

  describeScopeSelection({
    renderIdle: () => renderWithInsights(),
    renderShowingAnswer: () => renderWithInsights({
      data: WINNING_HOTELS_RESPONSE,
      fetchPromptInsights: neverSettlingFetch(),
    }),
    scopedHook: mockUsePromptInsights,
    loadingText: 'Loading insights...',
    answerMarker: () => screen.queryByText('Win Rate'),
  });
});
