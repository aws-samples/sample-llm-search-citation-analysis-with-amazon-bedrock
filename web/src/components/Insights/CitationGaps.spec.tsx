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
    it('renders the analysis heading when no request has completed', () => {
      renderWithGaps();

      expect(screen.getByText('Citation Gap Analysis')).toBeInTheDocument();
      expect(screen.getByText(/Discover sources that AI cites/)).toBeInTheDocument();
    });

    it('renders all available scopes when keywords and groups exist', () => {
      renderWithGaps();

      expect(renderedScopeOptionLabels('Filter by keyword or group')).toStrictEqual(['All keywords', 'Hotel Coruña (1)', 'hotels', 'resorts']);
    });

    it('fetches all-keyword gaps when the component mounts', () => {
      const fetchCitationGaps = renderWithGaps();

      expect(fetchCitationGaps).toHaveBeenCalledWith({ kind: 'all' }, 20);
    });

    it('does not claim great coverage when no request has completed', () => {
      renderWithGaps();

      expect(screen.queryByText(/Great coverage/)).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows only loading feedback when earlier results still exist', () => {
      renderWithGaps({
        data: buildCitationGapsResponse({ gaps: [MARRIOTT_ARTICLE_GAP] }),
        loading: true,
      });

      expect(screen.getByText('Analyzing citation gaps...')).toBeInTheDocument();
      expect(screen.queryByText('Test Article')).not.toBeInTheDocument();
      expect(screen.queryByText('Total Gaps')).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows only the failure when earlier results still exist', () => {
      renderWithGaps({
        data: buildCitationGapsResponse({ gaps: [MARRIOTT_ARTICLE_GAP] }),
        error: 'Failed to load citation gaps',
      });

      expect(screen.getByText('Failed to load citation gaps')).toBeInTheDocument();
      expect(screen.queryByText('Test Article')).not.toBeInTheDocument();
      expect(screen.queryByText('Total Gaps')).not.toBeInTheDocument();
      expect(screen.queryByText(/Great coverage/)).not.toBeInTheDocument();
    });

    it('does not claim great coverage when a request fails without prior data', () => {
      renderWithGaps({ error: 'Citation gap analysis timed out' });

      expect(screen.getByText('Citation gap analysis timed out')).toBeInTheDocument();
      expect(screen.queryByText(/Great coverage/)).not.toBeInTheDocument();
    });
  });

  describe('successful state', () => {
    it('renders exact summary values when gap data is available', () => {
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

    it('renders a gap card when a successful response contains a gap', () => {
      renderWithGaps({ data: buildCitationGapsResponse({ gaps: [MARRIOTT_ARTICLE_GAP] }) });

      expect(screen.getByText('Test Article')).toBeInTheDocument();
    });

    it('claims great coverage when a successful response contains no gaps', () => {
      renderWithGaps({ data: buildCitationGapsResponse() });

      expect(screen.getByText('No citation gaps found. Great coverage!')).toBeInTheDocument();
    });

    it('avoids duplicate-key console errors when different keywords share a URL', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      renderWithGaps({
        data: buildCitationGapsResponse({
          gaps: [
            {
              ...MARRIOTT_ARTICLE_GAP,
              keyword: 'hotels',
            },
            {
              ...MARRIOTT_ARTICLE_GAP,
              keyword: 'resorts',
            },
          ],
        }),
      });

      expect(screen.getAllByText('Test Article')).toHaveLength(2);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('scope changes', () => {
    it('fetches the selected keyword when the scope changes', async () => {
      const fetchCitationGaps = renderWithGaps();

      await userEvent.selectOptions(screen.getByRole('combobox'), 'keyword:hotels');

      expect(fetchCitationGaps).toHaveBeenCalledWith({
        kind: 'keyword',
        keyword: 'hotels' 
      }, 20);
    });

    it('hides the previous scope while the selected scope remains pending', async () => {
      const pendingFetch = vi.fn().mockImplementation(() => new Promise<null>(vi.fn()));
      renderWithGaps({
        data: buildCitationGapsResponse({ gaps: [MARRIOTT_ARTICLE_GAP] }),
        fetchCitationGaps: pendingFetch,
      });
      expect(screen.getByText('Test Article')).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByRole('combobox'), 'keyword:hotels');

      expect(screen.getByText('Analyzing citation gaps...')).toBeInTheDocument();
      expect(screen.queryByText('Test Article')).not.toBeInTheDocument();
    });
  });
});
