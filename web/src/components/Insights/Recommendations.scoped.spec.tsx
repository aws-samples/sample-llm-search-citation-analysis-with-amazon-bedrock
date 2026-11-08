import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { Recommendations } from './Recommendations';
import {
  render, screen
} from '@testing-library/react';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../test/scopedTestKit';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../hooks/useRecommendations', () => ({ useRecommendations: vi.fn() }));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { mockCorunaKeywordGroups } from './useScopeSelection-fixtures';
import { useRecommendations } from '../../hooks/useRecommendations';
import {
  TRACKED_RECOMMENDATION, VISIBILITY_GAP_RECOMMENDATION, buildRecommendationsHookResult, buildRecommendationsResponse
} from './Recommendations-fixtures';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';

const LATER = {
  ...VISIBILITY_GAP_RECOMMENDATION,
  id: 'rec-later',
  title: 'Fix the citation gap on page 2',
  status: 'new',
} as const;
const firstPage = buildRecommendationsResponse({
  recommendations: [TRACKED_RECOMMENDATION],
  next_token: 'tok-2',
  total: 120,
  coverage: {
    keywords_total: 5000,
    keywords_analyzed: 5000,
    complete: true,
  },
});
const REQUEST = {
  path: '/recommendations',
  params: new URLSearchParams({
    scope: 'all',
    use_llm: 'false',
  }),
};

describe('Recommendations on a 2.45.0 scope', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
    mockCorunaKeywordGroups();
    vi.mocked(useRecommendations).mockReturnValue(buildRecommendationsHookResult({
      data: firstPage,
      request: REQUEST,
    }));
  });

  it('says the recommendations cover every keyword of the scope', () => {
    render(<Recommendations keywords={SCOPE_KEYWORDS} />);

    expect(screen.getByText('Covers all 5,000 keywords')).toBeInTheDocument();
  });

  it('says how many of the scope\'s recommendations are listed', () => {
    render(<Recommendations keywords={SCOPE_KEYWORDS} />);

    expect(screen.getByText('Showing 1 of 120 recommendations')).toBeInTheDocument();
  });

  it('appends the next page of recommendations', async () => {
    answerFetchesInOrder([{
      ...firstPage,
      recommendations: [LATER],
      next_token: null,
    }, 200]);
    render(<Recommendations keywords={SCOPE_KEYWORDS} />);

    await clickLoadMore('recommendations');

    expect(await screen.findByText('Fix the citation gap on page 2')).toBeInTheDocument();
  });

  it('shows a status saved since the list loaded on its row', () => {
    vi.mocked(useRecommendations).mockReturnValue(buildRecommendationsHookResult({
      data: firstPage,
      request: REQUEST,
      savedStatuses: { 'rec-visibility': 'done' },
    }));

    render(<Recommendations keywords={SCOPE_KEYWORDS} />);

    expect(screen.getByRole('combobox', { name: 'Status of Improve visibility' })).toHaveValue('done');
  });

  it('exports every recommendation of the scope without asking the AI again', async () => {
    render(<Recommendations keywords={SCOPE_KEYWORDS} />);

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'recommendations',
      params: { scope: 'all' },
      format: 'xlsx',
    });
  });
});
