import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationGaps } from './CitationGaps';

vi.mock('../../hooks/useCitationGaps', () => ({useCitationGaps: vi.fn(),}));

import { useCitationGaps } from '../../hooks/useCitationGaps';

const mockUseCitationGaps = useCitationGaps as ReturnType<typeof vi.fn>;

function buildProps(overrides = {}) {
  return {
    keywords: [
      { keyword: 'hotels' },
      { keyword: 'resorts' },
    ],
    ...overrides,
  };
}

describe('CitationGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCitationGaps.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchCitationGaps: vi.fn(),
    });
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('Citation Gap Analysis')).toBeInTheDocument();
      expect(screen.getByText(/Discover sources that AI cites/)).toBeInTheDocument();
    });

    it('renders keyword filter with All Keywords option', () => {
      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('All Keywords')).toBeInTheDocument();
      expect(screen.getByText('hotels')).toBeInTheDocument();
    });

    it('fetches gaps on mount', () => {
      const fetchCitationGaps = vi.fn();
      mockUseCitationGaps.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchCitationGaps,
      });

      render(<CitationGaps {...buildProps()} />);

      expect(fetchCitationGaps).toHaveBeenCalledWith(undefined, 20);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      mockUseCitationGaps.mockReturnValue({
        data: null,
        loading: true,
        error: null,
        fetchCitationGaps: vi.fn(),
      });

      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('Analyzing citation gaps...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      mockUseCitationGaps.mockReturnValue({
        data: null,
        loading: false,
        error: 'Failed to fetch gaps',
        fetchCitationGaps: vi.fn(),
      });

      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('Failed to fetch gaps')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders gap stats when data available', () => {
      mockUseCitationGaps.mockReturnValue({
        data: {
          summary: {
            gap_count: 10,
            high_priority_gaps: 3,
            covered_count: 5,
            coverage_rate: 33.3 
          },
          gaps: [],
        },
        loading: false,
        error: null,
        fetchCitationGaps: vi.fn(),
      });

      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Total Gaps')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('High Priority')).toBeInTheDocument();
    });

    it('renders gap cards when gaps exist', () => {
      mockUseCitationGaps.mockReturnValue({
        data: {
          gaps: [
            {
              url: 'https://example.com/article',
              title: 'Test Article',
              priority: 'high',
              domain: 'example.com',
              competitor_brands: ['Marriott'],
              providers: ['openai'],
            },
          ],
        },
        loading: false,
        error: null,
        fetchCitationGaps: vi.fn(),
      });

      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('Test Article')).toBeInTheDocument();
    });

    it('shows no gaps message when gaps array is empty', () => {
      mockUseCitationGaps.mockReturnValue({
        data: {gaps: []},
        loading: false,
        error: null,
        fetchCitationGaps: vi.fn(),
      });

      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText(/No citation gaps found/)).toBeInTheDocument();
    });
  });

  describe('keyword filter', () => {
    it('fetches gaps for selected keyword', async () => {
      const fetchCitationGaps = vi.fn();
      mockUseCitationGaps.mockReturnValue({
        data: null,
        loading: false,
        error: null,
        fetchCitationGaps,
      });

      render(<CitationGaps {...buildProps()} />);

      const select = screen.getByRole('combobox');
      await userEvent.selectOptions(select, 'hotels');

      expect(fetchCitationGaps).toHaveBeenCalledWith('hotels', 20);
    });
  });
});
