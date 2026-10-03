import {
  describe, it, expect, vi
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePersonaRankings } from './usePersonaRankings';
import { SINGLE_PERSONA_RANKINGS } from '../components/Visibility/VisibilityDashboard-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  INVALID_REQUEST_ON_TYPE_GUARD_FAILURE, UNABLE_TO_LOAD_ON_NON_OK_STATUS, failedToLoadOnBackendError
} from './useAnalysisEndpoint-failure-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchPersonaRankingsArgs = Parameters<ReturnType<typeof usePersonaRankings>['fetchPersonaRankings']>;

describe('usePersonaRankings', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => usePersonaRankings());

    expect(result.current).toStrictEqual(idleEndpointState('fetchPersonaRankings'));
  });

  describeEndpointHookContract({
    subject: 'persona rankings',
    useHook: usePersonaRankings,
    fetchName: 'fetchPersonaRankings',
    fetch: (hook, ...args: FetchPersonaRankingsArgs) => hook.fetchPersonaRankings(...args),
    defaultResponse: SINGLE_PERSONA_RANKINGS,
    defaultArgs: ['hotels'],
    requests: [
      ['https://api.test.com/persona-rankings?keyword=hotels+in+madrid', 'only a keyword is given', ['hotels in madrid']],
      ['https://api.test.com/persona-rankings?keyword=hotels&query_prompt_id=prompt-7', 'a query prompt id is given', ['hotels', 'prompt-7']],
    ],
    successes: [
      ['persona rankings', SINGLE_PERSONA_RANKINGS, ['hotels']],
    ],
    failures: [
      UNABLE_TO_LOAD_ON_NON_OK_STATUS,
      failedToLoadOnBackendError('No rankings yet'),
      INVALID_REQUEST_ON_TYPE_GUARD_FAILURE,
      ['Invalid visibility request', 'payload is null', { nullResponse: true }],
    ],
    loggedHttpError: {
      logMessage: '[persona-rankings] Error fetching rankings:',
      name: 'PersonaRankingsFetchError',
      message: 'Failed to fetch persona rankings',
    },
  });
});
