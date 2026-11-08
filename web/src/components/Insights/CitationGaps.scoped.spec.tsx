import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { CitationGaps } from './CitationGaps';
import {
  fireEvent, render, screen, waitFor, within
} from '@testing-library/react';
import { createMockJsonResponse } from '../../test/fetchResponses';
import {
  clickLoadMore, computingLabel, COMPUTING_JOB
} from '../../test/scopedTestKit';

vi.mock('../../hooks/useCitationGaps');
vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { mockStartExport } from '../../test/exportsApiMock';
import { useCitationGaps } from '../../hooks/useCitationGaps';
import { buildKeywordGroupsHookResult } from '../../hooks/useKeywordGroups-fixtures';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import {
  buildCitationGapsHookResult, buildCitationGapsResponse, buildProps, MARRIOTT_ARTICLE_GAP
} from './CitationGaps-fixtures';

const NEXT_GAP = {
  ...MARRIOTT_ARTICLE_GAP,
  url: 'https://www.tripadvisor.es/hotels-galicia',
  domain: 'www.tripadvisor.es',
};

const SPA = {
  keyword: 'hotel con spa en galicia',
  gap_count: 4,
  high_priority_gaps: 2,
  coverage_rate: 25,
};
const LUGO = {
  ...SPA,
  keyword: 'hotel en lugo',
};
const scopedAnswer = buildCitationGapsResponse({
  keyword_summaries: [SPA],
  keyword_summaries_next_token: 'tok-2',
  keyword_summaries_total: 928,
  coverage: {
    keywords_total: 928,
    keywords_analyzed: 900,
    complete: false,
  },
});
const REQUEST = {
  path: '/citation-gaps',
  params: new URLSearchParams({
    scope: 'all',
    limit: '20',
  }),
};

describe('CitationGaps on a 2.45.0 scope', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    vi.mocked(useKeywordGroups).mockReturnValue(buildKeywordGroupsHookResult());
    vi.mocked(useCitationGaps).mockReturnValue(buildCitationGapsHookResult({
      data: scopedAnswer,
      request: REQUEST,
    }));
  });

  it('says how many keywords of the scope the gaps cover', () => {
    render(<CitationGaps {...buildProps()} />);

    expect(screen.getByRole('note')).toHaveTextContent('Covers 900 of 928 keywords.');
  });

  it('lists the gaps of each keyword with how many of the scope are shown', () => {
    render(<CitationGaps {...buildProps()} />);

    expect(screen.getByText('Showing 1 of 928 keywords')).toBeInTheDocument();
  });

  it('appends the next page of keyword summaries', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      ...scopedAnswer,
      keyword_summaries: [LUGO],
      keyword_summaries_next_token: null,
    }));
    render(<CitationGaps {...buildProps()} />);

    await clickLoadMore('keywords');

    expect(await within(screen.getByRole('table', { name: 'Gaps per keyword' })).findByText('hotel en lugo')).toBeInTheDocument();
  });

  it('says the gaps are being computed while a view job runs', () => {
    vi.mocked(useCitationGaps).mockReturnValue(buildCitationGapsHookResult({
      loading: true,
      computing: COMPUTING_JOB,
    }));

    render(<CitationGaps {...buildProps()} />);

    expect(computingLabel('citation gaps')).toBeInTheDocument();
  });

  it('appends the next gaps of the scope from view=gaps', async () => {
    vi.mocked(useCitationGaps).mockReturnValue(buildCitationGapsHookResult({
      data: {
        ...scopedAnswer,
        gaps_next_token: 'g-2',
        gaps_total: 412,
      },
      request: REQUEST,
    }));
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      gaps: [NEXT_GAP],
      gaps_total: 412,
      next_token: null,
    }));
    render(<CitationGaps {...buildProps()} />);

    await clickLoadMore('gaps');

    expect(await screen.findByText(NEXT_GAP.domain)).toBeInTheDocument();
  });

  it('asks the next gap page with view=gaps and the cursor', async () => {
    vi.mocked(useCitationGaps).mockReturnValue(buildCitationGapsHookResult({
      data: {
        ...scopedAnswer,
        gaps_next_token: 'g-2',
      },
      request: REQUEST,
    }));
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse({
      gaps: [NEXT_GAP],
      next_token: null,
    }));
    render(<CitationGaps {...buildProps()} />);

    await clickLoadMore('gaps');

    await waitFor(() => expect(String(mockAuthenticatedFetch.mock.calls[0]?.[0])).toBe('https://api.test.com/citation-gaps?scope=all&limit=20&view=gaps&next_token=g-2'));
  });

  it.each([
    ['citation-gaps', 1],
    ['gap-keyword-summaries', 0],
  ] as const)('exports every row of %s with the scope', async (view, buttonIndex) => {
    render(<CitationGaps {...buildProps()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Export all' })[buttonIndex]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));

    await waitFor(() => expect(mockStartExport).toHaveBeenCalledWith({
      view,
      params: { scope: 'all' },
      format: 'xlsx',
    }));
  });
});
