import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCitationGaps } from './useCitationGaps';
import {
  mockCitationGapsResponse, mockAllKeywordsResponse 
} from './useCitationGaps-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import {
  ALL_SCOPE, groupScope, keywordScope 
} from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchCitationGapsArgs = Parameters<ReturnType<typeof useCitationGaps>['fetchCitationGaps']>;

describe('useCitationGaps', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useCitationGaps());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchCitationGaps: expect.any(Function),
    });
  });

  describeEndpointHookContract({
    subject: 'citation gaps',
    useHook: useCitationGaps,
    fetchName: 'fetchCitationGaps',
    fetch: (hook, ...args: FetchCitationGapsArgs) => hook.fetchCitationGaps(...args),
    defaultResponse: mockCitationGapsResponse,
    defaultArgs: [keywordScope('test')],
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
      ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No brand config found' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ],
  });
});
