import {
  afterEach, beforeEach, describe, it, expect, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useCitationGaps } from './useCitationGaps';
import {
  mockCitationGapsResponse,
  mockAllKeywordsResponse,
  setupCitationGapsConsoleErrorMock
} from './useCitationGaps-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleScopedEndpointState } from '../test/idleEndpointState';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createEndpointMockFetch } from '../test/fetchResponses';

type FetchCitationGapsArgs = Parameters<ReturnType<typeof useCitationGaps>['fetchCitationGaps']>;

describe('useCitationGaps', () => {
  beforeEach(setupCitationGapsConsoleErrorMock);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an idle state when no citation-gap request has started', () => {
    const { result } = renderHook(() => useCitationGaps());

    expect(result.current).toStrictEqual({
      ...idleScopedEndpointState('fetchCitationGaps'),
      noData: false,
    });
  });

  it('settles the "No data found for keyword" body as "no data yet", not as an error', async () => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockCitationGapsResponse, { errorResponse: { error: 'No data found for keyword: never analysed' } }));
    const { result } = renderHook(() => useCitationGaps());

    const returned = await act(() => result.current.fetchCitationGaps(keywordScope('never analysed')));

    expect(returned).toBeNull();
    expect(result.current).toStrictEqual({
      ...idleScopedEndpointState('fetchCitationGaps'),
      noData: true,
    });
  });

  describeEndpointHookContract({
    scoped: true,
    subject: 'citation gaps',
    useHook: useCitationGaps,
    fetchName: 'fetchCitationGaps',
    fetch: (hook, ...args: FetchCitationGapsArgs) => hook.fetchCitationGaps(...args),
    defaultResponse: mockCitationGapsResponse,
    defaultArgs: [keywordScope('test')],
    otherState: { noData: false },
    requests: [
      ['https://api.test.com/citation-gaps?keyword=best+hotels&limit=10', 'a keyword scope is given', [keywordScope('best hotels')]],
      ['https://api.test.com/citation-gaps?keyword=test&limit=20', 'a limit is given', [keywordScope('test'), 20]],
      ['https://api.test.com/citation-gaps?group_id=grp-luxury&limit=10', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/citation-gaps?scope=all&limit=10', 'the all-keywords scope is given', [ALL_SCOPE]],
    ],
    successes: [
      ['single-keyword citation gaps', mockCitationGapsResponse, [keywordScope('best hotels')]],
      ['all-keywords citation gap rollup', mockAllKeywordsResponse, [ALL_SCOPE]],
    ],
    failures: [
      ['Failed to load citation gaps', 'request returns a server error', { shouldFail: true }],
      [
        'Citation gap analysis timed out',
        'gateway returns an integration timeout',
        {
          shouldFail: true,
          failStatus: 504,
        },
      ],
      [
        'Failed to load citation gaps',
        'response is a backend {error} body',
        { errorResponse: { error: 'No brand config found' } },
      ],
      ['Invalid citation gap request', 'payload fails the type guard', { invalidResponse: true }],
      ['Invalid citation gap request', 'payload is null', { nullResponse: true }],
    ],
    loggedHttpError: {
      logMessage: '[citationGaps] Error fetching citation gaps:',
      name: 'ApiRequestError',
      message: 'Failed to fetch citation gaps',
    },
  });
});
