import {
  describe, it, expect, vi
} from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  buildHttpError, useGroupKpiHistory
} from './useGroupKpiHistory';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  FAILED_TO_LOAD_ON_NON_OK_STATUS, failedToLoadOnBackendError
} from './useAnalysisEndpoint-failure-fixtures';
import {
  ALL_SCOPE, groupScope
} from '../components/ui/reportScope-fixtures';
import { buildHistory } from '../components/Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchGroupKpiHistoryArgs = Parameters<ReturnType<typeof useGroupKpiHistory>['fetchGroupKpiHistory']>;

describe('useGroupKpiHistory', () => {
  it('names the failed request and keeps its status', () => {
    const error = buildHttpError(404);

    expect([error.message, error.statusCode]).toStrictEqual(['Failed to fetch the group KPI history', 404]);
  });

  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useGroupKpiHistory());

    expect(result.current).toStrictEqual(idleEndpointState('fetchGroupKpiHistory'));
  });

  describeEndpointHookContract({
    subject: 'group KPI history',
    useHook: useGroupKpiHistory,
    fetchName: 'fetchGroupKpiHistory',
    fetch: (hook, ...args: FetchGroupKpiHistoryArgs) => hook.fetchGroupKpiHistory(...args),
    defaultResponse: buildHistory(),
    defaultArgs: [groupScope('hotel-sol'), 90],
    requests: [
      ['https://api.test.com/reports/group-kpis?group_id=hotel-sol&days=90', 'a group and 90 days are given', [groupScope('hotel-sol'), 90]],
      ['https://api.test.com/reports/group-kpis?scope=all&days=365', 'every keyword and 365 days are given', [ALL_SCOPE, 365]],
    ],
    successes: [
      ['group KPI history', buildHistory(), [groupScope('hotel-sol'), 90]],
    ],
    failures: [
      FAILED_TO_LOAD_ON_NON_OK_STATUS,
      failedToLoadOnBackendError('Unknown keyword group'),
      ['Invalid visibility request', 'payload is not a group KPI history', { invalidResponse: true }],
    ],
  });
});
