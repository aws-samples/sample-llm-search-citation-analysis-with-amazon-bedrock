import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Recommendations } from './Recommendations';

vi.mock('../../hooks/useRecommendations', () => ({useRecommendations: vi.fn(),}));

import { useRecommendations } from '../../hooks/useRecommendations';
import {
  VISIBILITY_GAP_RECOMMENDATION, buildRecommendationsHookResult, buildRecommendationsResponse 
} from './Recommendations-fixtures';

const mockUseRecommendations = vi.mocked(useRecommendations);

/** Renders the Action Center with the hook answering `overrides`; returns its `fetchRecommendations` spy. */
function renderWithRecommendations(overrides: Parameters<typeof buildRecommendationsHookResult>[0] = {}) {
  const hookResult = buildRecommendationsHookResult(overrides);
  mockUseRecommendations.mockReturnValue(hookResult);
  render(<Recommendations />);
  return hookResult.fetchRecommendations;
}

describe('Recommendations', () => {
  beforeEach(() => {
    mockUseRecommendations.mockReturnValue(buildRecommendationsHookResult());
  });

  describe('initial render', () => {
    it('renders header title', () => {
      renderWithRecommendations();

      expect(screen.getByText('Action Center')).toBeInTheDocument();
    });

    it('fetches recommendations on mount', () => {
      const fetchRecommendations = renderWithRecommendations();

      expect(fetchRecommendations).toHaveBeenCalledWith(false);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      renderWithRecommendations({ loading: true });

      expect(screen.getByText(/Generating recommendations/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      renderWithRecommendations({ error: 'Failed to load' });

      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders priority summary cards', () => {
      renderWithRecommendations({
        data: buildRecommendationsResponse({
          by_priority: {
            high: 3,
            medium: 5,
            low: 2 
          },
        }),
      });

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders recommendation cards', () => {
      renderWithRecommendations({
        data: buildRecommendationsResponse({
          recommendations: [VISIBILITY_GAP_RECOMMENDATION],
          by_priority: {
            high: 1,
            medium: 0,
            low: 0 
          },
        }),
      });

      expect(screen.getByText('Improve visibility')).toBeInTheDocument();
    });

    it('shows empty state when no recommendations', () => {
      renderWithRecommendations({ data: buildRecommendationsResponse() });

      expect(screen.getByText(/No recommendations available/)).toBeInTheDocument();
    });
  });

  describe('LLM toggle', () => {
    it('refetches with LLM when checkbox clicked', async () => {
      const fetchRecommendations = renderWithRecommendations({ data: buildRecommendationsResponse() });

      await userEvent.click(screen.getByRole('checkbox'));

      expect(fetchRecommendations).toHaveBeenCalledWith(true);
    });
  });
});
