import {
  describe, it, expect, vi 
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useRecommendations } from './useRecommendations';
import {
  mockRecommendationsResponse, renderFetchedRecommendations, statusesOf, trackedRecommendation
} from './useRecommendations-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import { createDeferredValue } from '../test/fetchResponses';
import { TestError } from '../test/testError';
import { saveRecommendationStatus } from '../api/recommendations';
import {
  INVALID_REQUEST_ON_TYPE_GUARD_FAILURE, UNABLE_TO_LOAD_ON_NON_OK_STATUS
} from './useAnalysisEndpoint-failure-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../api/recommendations', () => ({ saveRecommendationStatus: vi.fn() }));

const mockSaveStatus = vi.mocked(saveRecommendationStatus);

type FetchRecommendationsArgs = Parameters<ReturnType<typeof useRecommendations>['fetchRecommendations']>;

const IDLE_STATUS_STATE = {
  updatingIds: [],
  statusError: null,
};

describe('useRecommendations', () => {
  it('starts with no data, not loading, no error and no status update in flight', () => {
    const { result } = renderHook(() => useRecommendations());

    expect(result.current).toStrictEqual({
      ...idleEndpointState('fetchRecommendations', 'updateStatus'),
      ...IDLE_STATUS_STATE,
    });
  });

  describeEndpointHookContract({
    subject: 'recommendations',
    useHook: useRecommendations,
    fetchName: 'fetchRecommendations',
    fetch: (hook, ...args: FetchRecommendationsArgs) => hook.fetchRecommendations(...args),
    otherFunctions: ['updateStatus'],
    otherState: IDLE_STATUS_STATE,
    defaultResponse: mockRecommendationsResponse,
    defaultArgs: [],
    // The recommendations fetch is not abortable: it passes only the URL.
    expectedRequest: (url) => [url],
    requests: [
      ['https://api.test.com/recommendations?use_llm=false', 'no arguments are given', []],
      ['https://api.test.com/recommendations?use_llm=true', 'LLM generation is requested', [true]],
    ],
    successes: [
      ['recommendations', mockRecommendationsResponse, []],
    ],
    failures: [
      UNABLE_TO_LOAD_ON_NON_OK_STATUS,
      INVALID_REQUEST_ON_TYPE_GUARD_FAILURE,
    ],
  });

  describe('updateStatus', () => {
    it('shows the status the API saved on that recommendation only', async () => {
      mockSaveStatus.mockResolvedValue('done');
      const { result } = await renderFetchedRecommendations();

      await act(async () => {
        await result.current.updateStatus(trackedRecommendation(0), 'done');
      });

      expect(statusesOf(result.current.data)).toStrictEqual(['done', 'in_progress']);
    });

    it('sends the recommendation it was given and the chosen status', async () => {
      mockSaveStatus.mockResolvedValue('wontfix');
      const { result } = await renderFetchedRecommendations();

      await act(async () => {
        await result.current.updateStatus(trackedRecommendation(1), 'wontfix');
      });

      expect(mockSaveStatus).toHaveBeenCalledWith(trackedRecommendation(1), 'wontfix');
    });

    it('keeps the previous status and reports the error when the save fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockSaveStatus.mockRejectedValue(new TestError('Server unavailable'));
      const { result } = await renderFetchedRecommendations();

      const saved = await act(() => result.current.updateStatus(trackedRecommendation(0), 'done'));

      expect({
        saved,
        statuses: statusesOf(result.current.data),
        statusError: result.current.statusError,
      }).toStrictEqual({
        saved: false,
        statuses: ['new', 'in_progress'],
        statusError: 'Server error occurred',
      });
    });

    it('marks the recommendation as updating until the save settles', async () => {
      const pending = createDeferredValue<'done'>();
      mockSaveStatus.mockReturnValue(pending.promise);
      const { result } = await renderFetchedRecommendations();

      const update = { settled: Promise.resolve(false) };
      act(() => {
        update.settled = result.current.updateStatus(trackedRecommendation(0), 'done');
      });
      const whileSaving = result.current.updatingIds;
      await act(async () => {
        pending.resolve('done');
        await update.settled;
      });

      expect([whileSaving, result.current.updatingIds]).toStrictEqual([['rec-001'], []]);
    });
  });

});
