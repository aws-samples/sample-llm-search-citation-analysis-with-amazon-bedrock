import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityDashboard } from './VisibilityDashboard';

vi.mock('../../hooks/useVisibilityMetrics', () => ({useVisibilityMetrics: vi.fn(),}));

vi.mock('../../hooks/useHistoricalTrends', () => ({useHistoricalTrends: vi.fn(),}));

vi.mock('../../hooks/usePersonaRankings', () => ({usePersonaRankings: vi.fn(),}));

import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';

const mockUseVisibilityMetrics = useVisibilityMetrics as ReturnType<typeof vi.fn>;
const mockUseHistoricalTrends = useHistoricalTrends as ReturnType<typeof vi.fn>;
const mockUsePersonaRankings = usePersonaRankings as ReturnType<typeof vi.fn>;

function buildProps(overrides = {}) {
  return {
    keywords: [
      { keyword: 'hotels' },
      { keyword: 'resorts' },
    ],
    ...overrides,
  };
}

describe('VisibilityDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVisibilityMetrics.mockReturnValue({
      data: null,
      loading: false,
      fetchVisibilityMetrics: vi.fn(),
    });
    mockUseHistoricalTrends.mockReturnValue({
      data: null,
      loading: false,
      fetchHistoricalTrends: vi.fn(),
    });
    mockUsePersonaRankings.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchPersonaRankings: vi.fn(),
    });
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      render(<VisibilityDashboard {...buildProps()} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/Track how visible your brand is/)).toBeInTheDocument();
    });

    it('renders keyword selector with all keywords', () => {
      render(<VisibilityDashboard {...buildProps()} />);

      const selects = screen.getAllByRole('combobox');
      expect(selects[0]).toBeInTheDocument();
      expect(screen.getByText('hotels')).toBeInTheDocument();
      expect(screen.getByText('resorts')).toBeInTheDocument();
    });

    it('selects first keyword by default', () => {
      const fetchVisibilityMetrics = vi.fn();
      mockUseVisibilityMetrics.mockReturnValue({
        data: null,
        loading: false,
        fetchVisibilityMetrics,
      });

      render(<VisibilityDashboard {...buildProps()} />);

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith('hotels', undefined, undefined);
    });
  });

  describe('loading state', () => {
    it('shows loading message when visibility is loading', () => {
      mockUseVisibilityMetrics.mockReturnValue({
        data: null,
        loading: true,
        fetchVisibilityMetrics: vi.fn(),
      });

      render(<VisibilityDashboard {...buildProps()} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });

    it('shows loading message when trends is loading', () => {
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: true,
        fetchHistoricalTrends: vi.fn(),
      });

      render(<VisibilityDashboard {...buildProps()} />);

      expect(screen.getByText('Loading visibility data...')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders brand rankings table when data available', () => {
      mockUseVisibilityMetrics.mockReturnValue({
        data: {
          summary: {
            first_party_avg_score: 75,
            competitor_avg_score: 60 
          },
          brands: [
            {
              name: 'Marriott',
              score: 80,
              share_of_voice: 0.3,
              best_rank: 1,
              mention_count: 10,
              providers: ['openai'],
              classification: 'first_party' 
            },
          ],
        },
        loading: false,
        fetchVisibilityMetrics: vi.fn(),
      });

      render(<VisibilityDashboard {...buildProps()} />);

      expect(screen.getByText('Brand Rankings')).toBeInTheDocument();
      expect(screen.getByText('Marriott')).toBeInTheDocument();
    });

    it('shows no data message when brands is undefined', () => {
      mockUseVisibilityMetrics.mockReturnValue({
        data: {
          summary: {},
          brands: undefined 
        },
        loading: false,
        fetchVisibilityMetrics: vi.fn(),
      });

      render(<VisibilityDashboard {...buildProps()} />);

      expect(screen.getByText('No brand data available.')).toBeInTheDocument();
    });
  });

  describe('keyword selection', () => {
    it('fetches data when keyword changes', async () => {
      const fetchVisibilityMetrics = vi.fn();
      const fetchHistoricalTrends = vi.fn();
      mockUseVisibilityMetrics.mockReturnValue({
        data: null,
        loading: false,
        fetchVisibilityMetrics,
      });
      mockUseHistoricalTrends.mockReturnValue({
        data: null,
        loading: false,
        fetchHistoricalTrends,
      });

      render(<VisibilityDashboard {...buildProps()} />);

      const selects = screen.getAllByRole('combobox');
      await userEvent.selectOptions(selects[0], 'resorts');

      expect(fetchVisibilityMetrics).toHaveBeenCalledWith('resorts', undefined, undefined);
      expect(fetchHistoricalTrends).toHaveBeenCalledWith('resorts', 'day', 30);
    });
  });

  describe('empty keywords', () => {
    it('renders without errors when keywords is empty', () => {
      render(<VisibilityDashboard {...buildProps({ keywords: [] })} />);

      expect(screen.getByText('Visibility Dashboard')).toBeInTheDocument();
    });
  });
});
