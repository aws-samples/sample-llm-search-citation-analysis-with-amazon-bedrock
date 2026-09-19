import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationGaps } from './CitationGaps';

vi.mock('../../hooks/useCitationGaps', () => ({useCitationGaps: vi.fn(),}));
vi.mock('../../hooks/useKeywordGroups', () => ({ useKeywordGroups: vi.fn() }));

import { useCitationGaps } from '../../hooks/useCitationGaps';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { renderedScopeOptionLabels } from '../ui/KeywordScopeSelector-fixtures';
import {
  MARRIOTT_ARTICLE_GAP, buildCitationGapsHookResult, buildCitationGapsResponse, buildProps 
} from './CitationGaps-fixtures';

const mockUseCitationGaps = vi.mocked(useCitationGaps);
const mockUseKeywordGroups = vi.mocked(useKeywordGroups);

/** Renders the view with the hook answering `overrides`; returns its `fetchCitationGaps` spy. */
function renderWithGaps(overrides: Parameters<typeof buildCitationGapsHookResult>[0] = {}) {
  const hookResult = buildCitationGapsHookResult(overrides);
  mockUseCitationGaps.mockReturnValue(hookResult);
  render(<CitationGaps {...buildProps()} />);
  return hookResult.fetchCitationGaps;
}

describe('CitationGaps', () => {
  beforeEach(() => {
    mockUseCitationGaps.mockReturnValue(buildCitationGapsHookResult());
    mockUseKeywordGroups.mockReturnValue(buildKeywordGroupsHookResult());
  });

  describe('initial render', () => {
    it('renders title and description', () => {
      renderWithGaps();

      expect(screen.getByText('Citation Gap Analysis')).toBeInTheDocument();
      expect(screen.getByText(/Discover sources that AI cites/)).toBeInTheDocument();
    });

    it('renders the scope filter with all keywords, groups and keywords', () => {
      renderWithGaps();

      expect(renderedScopeOptionLabels('Filter by keyword or group')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
    });

    it('fetches gaps on mount', () => {
      const fetchCitationGaps = renderWithGaps();

      expect(fetchCitationGaps).toHaveBeenCalledWith({ kind: 'all' }, 20);
    });
  });

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      renderWithGaps({ loading: true });

      expect(screen.getByText('Analyzing citation gaps...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when error occurs', () => {
      renderWithGaps({ error: 'Failed to fetch gaps' });

      expect(screen.getByText('Failed to fetch gaps')).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('renders gap stats when data available', () => {
      renderWithGaps({
        data: buildCitationGapsResponse({
          summary: {
            gap_count: 10,
            high_priority_gaps: 3,
            covered_count: 5,
            coverage_rate: 33.3 
          },
        }),
      });

      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Total Gaps')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('High Priority')).toBeInTheDocument();
    });

    it('renders gap cards when gaps exist', () => {
      renderWithGaps({ data: buildCitationGapsResponse({ gaps: [MARRIOTT_ARTICLE_GAP] }) });

      expect(screen.getByText('Test Article')).toBeInTheDocument();
    });

    it('shows no gaps message when gaps array is empty', () => {
      renderWithGaps({ data: buildCitationGapsResponse() });

      expect(screen.getByText(/No citation gaps found/)).toBeInTheDocument();
    });
  });

  describe('keyword filter', () => {
    it('fetches gaps for selected keyword', async () => {
      const fetchCitationGaps = renderWithGaps();

      await userEvent.selectOptions(screen.getByRole('combobox'), 'keyword:hotels');

      expect(fetchCitationGaps).toHaveBeenCalledWith({
        kind: 'keyword',
        keyword: 'hotels' 
      }, 20);
    });
  });
});
