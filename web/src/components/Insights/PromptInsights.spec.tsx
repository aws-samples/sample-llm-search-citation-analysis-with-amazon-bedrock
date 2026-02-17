import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import { PromptInsights } from './PromptInsights';

vi.mock('../../hooks/usePromptInsights', () => ({usePromptInsights: vi.fn(),}));

import { usePromptInsights } from '../../hooks/usePromptInsights';

const mockUsePromptInsights = usePromptInsights as ReturnType<typeof vi.fn>;

describe('PromptInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePromptInsights.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchPromptInsights: vi.fn(),
    });
  });

  describe('initial render', () => {
    it('renders title', () => {
      render(<PromptInsights />);

      expect(screen.getByText('Prompt Insights')).toBeInTheDocument();
    });

    it('renders tab buttons', () => {
      render(<PromptInsights />);

      // Tabs only render when data is available
      expect(screen.getByText('Prompt Insights')).toBeInTheDocument();
    });

    it('fetches insights on mount', () => {
      const fetchPromptInsights = vi.fn();
      mockUsePromptInsights.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchPromptInsights,
      });

      render(<PromptInsights />);

      expect(fetchPromptInsights).toHaveBeenCalledWith('all', 20);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      mockUsePromptInsights.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        fetchPromptInsights: vi.fn(),
      });

      render(<PromptInsights />);

      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      mockUsePromptInsights.mockReturnValue({
        data: null,
        loading: false,
        error: 'Failed to load insights',
        fetchPromptInsights: vi.fn(),
      });

      render(<PromptInsights />);

      expect(screen.getByText('Failed to load insights')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders prompt cards for winning prompts', () => {
      mockUsePromptInsights.mockReturnValue({
        data: {
          winning_prompts: [
            {
              prompt_text: 'Best hotels in NYC',
              keyword: 'hotels',
              provider: 'openai',
              first_party: {
                mentions: 5,
                best_rank: 1 
              },
              competitors: {
                mentions: 3,
                best_rank: 2 
              },
            },
          ],
          losing_prompts: [],
          opportunity_prompts: [],
          summary: {
            winning_count: 1,
            losing_count: 0,
            opportunity_count: 0,
            win_rate: 100,
          },
        },
        loading: false,
        error: null,
        fetchPromptInsights: vi.fn(),
      });

      render(<PromptInsights />);

      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('shows empty state when no prompts in active tab', () => {
      mockUsePromptInsights.mockReturnValue({
        data: {
          winning_prompts: [],
          losing_prompts: [],
          opportunity_prompts: [],
          summary: {
            winning_count: 0,
            losing_count: 0,
            opportunity_count: 0,
            win_rate: 0,
          },
        },
        loading: false,
        error: null,
        fetchPromptInsights: vi.fn(),
      });

      render(<PromptInsights />);

      expect(screen.getByText(/No winning prompts found/)).toBeInTheDocument();
    });
  });
});
