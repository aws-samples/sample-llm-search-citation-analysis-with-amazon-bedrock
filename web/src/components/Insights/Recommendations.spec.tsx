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

const mockUseRecommendations = useRecommendations as ReturnType<typeof vi.fn>;

describe('Recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRecommendations.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchRecommendations: vi.fn(),
    });
  });

  describe('initial render', () => {
    it('renders header title', () => {
      render(<Recommendations />);

      expect(screen.getByText('Action Center')).toBeInTheDocument();
    });

    it('fetches recommendations on mount', () => {
      const fetchRecommendations = vi.fn();
      mockUseRecommendations.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchRecommendations,
      });

      render(<Recommendations />);

      expect(fetchRecommendations).toHaveBeenCalledWith(false);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      mockUseRecommendations.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        fetchRecommendations: vi.fn(),
      });

      render(<Recommendations />);

      expect(screen.getByText(/Generating recommendations/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      mockUseRecommendations.mockReturnValue({
        data: null,
        loading: false,
        error: 'Failed to load',
        fetchRecommendations: vi.fn(),
      });

      render(<Recommendations />);

      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders priority summary cards', () => {
      mockUseRecommendations.mockReturnValue({
        data: {
          recommendations: [],
          by_priority: {
            high: 3,
            medium: 5,
            low: 2 
          },
        },
        loading: false,
        error: null,
        fetchRecommendations: vi.fn(),
      });

      render(<Recommendations />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders recommendation cards', () => {
      mockUseRecommendations.mockReturnValue({
        data: {
          recommendations: [
            {
              type: 'visibility_gap',
              priority: 'high',
              title: 'Improve visibility',
              description: 'Your brand needs more mentions',
              action: 'Create content',
              impact: 'High',
            },
          ],
          by_priority: {
            high: 1,
            medium: 0,
            low: 0 
          },
        },
        loading: false,
        error: null,
        fetchRecommendations: vi.fn(),
      });

      render(<Recommendations />);

      expect(screen.getByText('Improve visibility')).toBeInTheDocument();
    });

    it('shows empty state when no recommendations', () => {
      mockUseRecommendations.mockReturnValue({
        data: {
          recommendations: [],
          by_priority: {
            high: 0,
            medium: 0,
            low: 0 
          },
        },
        loading: false,
        error: null,
        fetchRecommendations: vi.fn(),
      });

      render(<Recommendations />);

      expect(screen.getByText(/No recommendations available/)).toBeInTheDocument();
    });
  });

  describe('LLM toggle', () => {
    it('refetches with LLM when checkbox clicked', async () => {
      const fetchRecommendations = vi.fn();
      mockUseRecommendations.mockReturnValue({
        data: {
          recommendations: [],
          by_priority: {
            high: 0,
            medium: 0,
            low: 0 
          },
        },
        loading: false,
        error: null,
        fetchRecommendations,
      });

      render(<Recommendations />);

      const checkbox = screen.getByRole('checkbox');
      await userEvent.click(checkbox);

      expect(fetchRecommendations).toHaveBeenCalledWith(true);
    });
  });
});
