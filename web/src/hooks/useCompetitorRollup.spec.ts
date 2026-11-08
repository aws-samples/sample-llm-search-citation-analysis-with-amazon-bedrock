import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitorRollup } from './useCompetitorRollup';
import { mockSingleCompetitorRollup } from './useCompetitorRollup-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleScopedEndpointState } from '../test/idleEndpointState';
import {failedToLoadOnBackendError} from './useAnalysisEndpoint-failure-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchCompetitorRollupArgs = Parameters<ReturnType<typeof useCompetitorRollup>['fetchCompetitorRollup']>;

describe('useCompetitorRollup', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useCompetitorRollup());

    expect(result.current).toStrictEqual(idleScopedEndpointState('fetchCompetitorRollup'));
  });

  describeEndpointHookContract({
    scoped: true,
    subject: 'competitor',
    useHook: useCompetitorRollup,
    fetchName: 'fetchCompetitorRollup',
    fetch: (hook, ...args: FetchCompetitorRollupArgs) => hook.fetchCompetitorRollup(...args),
    defaultResponse: mockSingleCompetitorRollup,
    defaultArgs: ['Unknown'],
    requests: [
      ['https://api.test.com/reports/competitor?scope=all&competitor=Adidas&limit=100', 'a competitor is given', ['Adidas']],
      ['https://api.test.com/reports/competitor?scope=all&competitor=Brand+%26+Co&limit=100', 'the competitor name has special characters', ['Brand & Co']],
      ['https://api.test.com/reports/competitor?group_id=hotel-sol&competitor=Adidas&limit=100', 'a keyword group scope is given', ['Adidas', {
        kind: 'group',
        groupId: 'hotel-sol',
      }]],
      ['https://api.test.com/reports/competitor?scope=all&competitor=Adidas&limit=75', 'a page size is given', ['Adidas', undefined, 75]],
    ],
    successes: [
      ['single-competitor rollup', mockSingleCompetitorRollup, ['Adidas']],
    ],
    failures: [
      ['Invalid visibility request', 'request is rejected with a 400', {
        shouldFail: true,
        failStatus: 400,
      }],
      failedToLoadOnBackendError('Unknown competitor'),
      ['Invalid visibility request', 'payload has no rollup', { invalidResponse: true }],
      ['Invalid visibility request', 'payload is null', { nullResponse: true }],
    ],
    loggedHttpError: {
      logMessage: '[competitorRollup] Error:',
      name: 'ApiRequestError',
      message: 'Failed to fetch competitor rollup',
    },
  });
});
