import { PromptInsights } from './PromptInsights';
import {
  describe, expect, it, vi
} from 'vitest';
import {
  render, screen, waitFor
} from '@testing-library/react';
import {
  answerFetchesInOrder, clickLoadMore, computingLabel, COMPUTING_JOB
} from '../../test/scopedTestKit';

vi.mock('../../hooks/useKeywordGroups');
vi.mock('../../hooks/usePromptInsights', () => ({ usePromptInsights: vi.fn() }));
vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));
vi.mock('../../api/exports', () => import('../../test/exportsApiMock'));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import {
  chooseExportFormat, mockStartExport
} from '../../test/exportsApiMock';
import { mockCorunaKeywordGroups } from './useScopeSelection-fixtures';
import { usePromptInsights } from '../../hooks/usePromptInsights';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import {
  WINNING_HOTELS_RESPONSE, buildPromptInsightsHookResult
} from './PromptInsights-fixtures';

const REQUEST = {
  path: '/prompt-insights',
  params: new URLSearchParams({
    group_id: 'g1',
    type: 'all',
    limit: '20',
  }),
};

const scopedAnswer = {
  ...WINNING_HOTELS_RESPONSE,
  summary: {
    ...WINNING_HOTELS_RESPONSE.summary,
    winning_count: 1240,
  },
  coverage: {
    keywords_total: 5000,
    keywords_analyzed: 5000,
    complete: true,
  },
};

/** Renders the tab over the scope keywords with the prompt-insights hook in `state`. */
function renderPromptInsightsWith(state: Parameters<typeof buildPromptInsightsHookResult>[0]) {
  vi.mocked(usePromptInsights).mockReturnValue(buildPromptInsightsHookResult(state));
  mockCorunaKeywordGroups();
  render(<PromptInsights keywords={SCOPE_KEYWORDS} />);
}

describe('PromptInsights on a 2.45.0 scope', () => {
  it.each([
    ['says the prompts cover every keyword of the scope', 'Covers all 5,000 keywords'],
    ['says how many of the scope\'s winning prompts the tab lists', 'Showing 1 of 1,240 winning prompts'],
  ])('%s', (_name, text) => {
    renderPromptInsightsWith({ data: scopedAnswer });

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('appends the next winning prompts from the tab\'s cursor', async () => {
    answerFetchesInOrder([{
      ...scopedAnswer,
      winning_prompts: [{
        ...WINNING_HOTELS_RESPONSE.winning_prompts[0],
        keyword: 'hotels lugo',
      }],
      winning_prompts_next_token: null,
    }, 200]);
    renderPromptInsightsWith({
      data: {
        ...scopedAnswer,
        winning_prompts_next_token: 'w-2',
      },
      request: REQUEST,
    });

    await clickLoadMore('prompts');

    expect(await screen.findByText('hotels lugo')).toBeInTheDocument();
  });

  it('asks the next page of the tab with type and the cursor', async () => {
    answerFetchesInOrder([{
      ...scopedAnswer,
      winning_prompts_next_token: null,
    }, 200]);
    renderPromptInsightsWith({
      data: {
        ...scopedAnswer,
        winning_prompts_next_token: 'w-2',
      },
      request: REQUEST,
    });

    await clickLoadMore('prompts');

    await waitFor(() => expect(String(mockAuthenticatedFetch.mock.calls[0]?.[0])).toBe('https://api.test.com/prompt-insights?group_id=g1&type=winning&limit=20&next_token=w-2'));
  });

  it('exports every prompt of the scope', async () => {
    renderPromptInsightsWith({
      data: scopedAnswer,
      request: REQUEST,
    });

    await chooseExportFormat('xlsx');

    expect(mockStartExport).toHaveBeenCalledWith({
      view: 'prompt-insights',
      params: {
        group_id: 'g1',
        type: 'all',
      },
      format: 'xlsx',
    });
  });

  it('says the prompt insights are being computed while a view job runs', () => {
    renderPromptInsightsWith({
      loading: true,
      computing: COMPUTING_JOB,
    });

    expect(computingLabel('prompt insights')).toBeInTheDocument();
  });
});
