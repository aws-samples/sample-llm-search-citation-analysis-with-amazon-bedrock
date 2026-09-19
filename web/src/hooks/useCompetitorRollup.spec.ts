import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitorRollup } from './useCompetitorRollup';
import {
  mockSingleCompetitorRollup, mockAllCompetitorsRollup 
} from './useCompetitorRollup-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchCompetitorRollupArgs = Parameters<ReturnType<typeof useCompetitorRollup>['fetchCompetitorRollup']>;

describe('useCompetitorRollup', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useCompetitorRollup());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchCompetitorRollup: expect.any(Function),
    });
  });

  describeEndpointHookContract({
    subject: 'competitor',
    useHook: useCompetitorRollup,
    fetchName: 'fetchCompetitorRollup',
    fetch: (hook, ...args: FetchCompetitorRollupArgs) => hook.fetchCompetitorRollup(...args),
    defaultResponse: mockSingleCompetitorRollup,
    defaultArgs: ['Unknown'],
    requests: [
      ['https://api.test.com/reports/competitor?keyword_limit=50&competitor=Adidas', 'a competitor is given', ['Adidas']],
      ['https://api.test.com/reports/competitor?keyword_limit=50&competitor=Brand+%26+Co', 'the competitor name has special characters', ['Brand & Co']],
      ['https://api.test.com/reports/competitor?keyword_limit=75&competitor=Adidas', 'a keyword limit is given', ['Adidas', 75]],
      ['https://api.test.com/reports/competitor?keyword_limit=50', 'no competitor is given', []],
    ],
    successes: [
      ['single-competitor rollup', mockSingleCompetitorRollup, ['Adidas']],
      ['all-competitors rollup', mockAllCompetitorsRollup, []],
    ],
    failures: [
      ['Invalid visibility request', 'request is rejected with a 400', {
        shouldFail: true,
        failStatus: 400,
      }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'Unknown competitor' } }],
      ['Invalid visibility request', 'payload has neither rollup nor rollups', { invalidResponse: true }],
    ],
  });
});
