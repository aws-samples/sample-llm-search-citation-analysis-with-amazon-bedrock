import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationGaps } from './CitationGaps';
import type { Keyword } from '../../types';

vi.mock('../../hooks/useCitationGaps', () => ({useCitationGaps: vi.fn(),}));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { useCitationGaps } from '../../hooks/useCitationGaps';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';

const mockUseCitationGaps = useCitationGaps as ReturnType<typeof vi.fn>;
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

const KEYWORDS: Keyword[] = [
  {
    id: 'kw-1',
    keyword: 'hotels',
    created_at: '2026-01-01T00:00:00Z',
    group_ids: ['group-coruna'] 
  },
  {
    id: 'kw-2',
    keyword: 'resorts',
    created_at: '2026-01-02T00:00:00Z' 
  },
];

function buildProps(overrides: { keywords?: Keyword[] } = {}) {
  return {keywords: overrides.keywords ?? KEYWORDS,};
}

describe('CitationGaps', () => {
  beforeEach(() => {
    mockUseCitationGaps.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchCitationGaps: vi.fn(),
    });
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult());
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      render(<CitationGaps {...buildProps()} />);

      expect(screen.getByText('Citation Gap Analysis')).toBeInTheDocument();
      expect(screen.getByText(/Discover sources that AI cites/)).toBeInTheDocument();
    });

    it('renders the scope filter with all keywords, groups and keywords', () => {
      render(<CitationGaps {...buildProps()} />);

      expect(renderedScopeOptionLabels('Filter by keyword or group')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
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

      expect(fetchCitationGaps).toHaveBeenCalledWith({ kind: 'all' }, 20);
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
      await userEvent.selectOptions(select, 'keyword:hotels');

      expect(fetchCitationGaps).toHaveBeenCalledWith({
        kind: 'keyword',
        keyword: 'hotels' 
      }, 20);
    });
  });
});
