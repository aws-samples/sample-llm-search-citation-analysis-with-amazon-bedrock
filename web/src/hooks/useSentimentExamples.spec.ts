import {
  describe, it, expect, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useSentimentExamples } from './useSentimentExamples';
import { renderAnsweredWith } from './useVisibilityMetrics-fixtures';
import { renderDeferredEndpoint } from './useAnalysisEndpoint-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import { createEndpointMockFetch } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';
import {
  buildSentimentExamplesResponse, REJECTED_SENTIMENT_EXAMPLES_BODIES, SPARSE_SENTIMENT_EXAMPLES
} from '../types/domain/sentimentExamples-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchSentimentExamplesArgs = Parameters<ReturnType<typeof useSentimentExamples>['fetchSentimentExamples']>;

const EXAMPLES = buildSentimentExamplesResponse();
const ENDPOINT = 'https://api.test.com/visibility/sentiment-examples';

describe('useSentimentExamples', () => {
  it('starts with no examples, not loading, and no error', () => {
    const { result } = renderHook(() => useSentimentExamples());

    expect(result.current).toStrictEqual(idleEndpointState('fetchSentimentExamples'));
  });

  describeEndpointHookContract({
    subject: 'sentiment examples',
    useHook: useSentimentExamples,
    fetchName: 'fetchSentimentExamples',
    fetch: (hook, ...args: FetchSentimentExamplesArgs) => hook.fetchSentimentExamples(...args),
    defaultResponse: EXAMPLES,
    defaultArgs: [groupScope('grp-sol'), 'negative', 'openai'],
    requests: [
      [`${ENDPOINT}?scope=all&sentiment=positive`, 'every engine of every keyword is asked for', [ALL_SCOPE, 'positive']],
      [`${ENDPOINT}?group_id=grp-sol&sentiment=negative&provider=openai`, 'one engine of a group is asked for', [groupScope('grp-sol'), 'negative', 'openai']],
      [`${ENDPOINT}?keyword=hotel+coruna+spa&sentiment=mixed`, 'a keyword scope is given', [keywordScope('hotel coruna spa'), 'mixed']],
      [`${ENDPOINT}?scope=all&sentiment=neutral&provider=gemini&limit=50`, 'a limit is given', [ALL_SCOPE, 'neutral', 'gemini', 50]],
      [`${ENDPOINT}?scope=all&sentiment=neutral&limit=5`, 'a limit is given without an engine', [ALL_SCOPE, 'neutral', undefined, 5]],
    ],
    successes: [
      ['examples of one engine', EXAMPLES, [groupScope('grp-sol'), 'negative', 'openai']],
      ['examples of every engine with null details', SPARSE_SENTIMENT_EXAMPLES, [ALL_SCOPE, 'negative']],
    ],
    failures: [
      ['Unable to load the answers', 'request returns a non-ok status', {
        shouldFail: true,
        failStatus: 400,
      }],
      ['Failed to load the answers', 'response is a backend {error} body', { errorResponse: { error: 'Unknown sentiment' } }],
      ['Invalid answers request', 'payload fails the type guard', { invalidResponse: true }],
    ],
  });

  it.each(REJECTED_SENTIMENT_EXAMPLES_BODIES)('stores no examples and reports an invalid request for %s', async (_description, body) => {
    const state = await renderAnsweredWith(useSentimentExamples, (hook) => hook.fetchSentimentExamples(ALL_SCOPE, 'negative'), body);

    expect(state).toStrictEqual({
      data: null,
      error: 'Invalid answers request',
    });
  });

  it('logs a failed request under its own tag and error class', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(EXAMPLES, { shouldFail: true }));
    const { result } = renderHook(() => useSentimentExamples());

    await act(() => result.current.fetchSentimentExamples(ALL_SCOPE, 'negative'));

    expect(consoleError).toHaveBeenCalledWith('[sentiment] Error fetching sentiment examples:', expect.objectContaining({ name: 'SentimentExamplesFetchError' }));
  });

  describe('cancellation', () => {
    it('aborts the examples of the previous count when another count is fetched', () => {
      const {
        deferred, startRequest
      } = renderDeferredEndpoint(useSentimentExamples);

      startRequest((hook) => hook.fetchSentimentExamples(ALL_SCOPE, 'negative', 'openai'));
      startRequest((hook) => hook.fetchSentimentExamples(ALL_SCOPE, 'positive', 'gemini'));

      expect(deferred.requests.map((request) => request.signal?.aborted)).toStrictEqual([true, false]);
    });

    it('aborts the request in flight when the view unmounts', () => {
      const {
        deferred, startRequest, unmount
      } = renderDeferredEndpoint(useSentimentExamples);

      startRequest((hook) => hook.fetchSentimentExamples(groupScope('grp-sol'), 'mixed'));
      unmount();

      expect(deferred.requests[0].signal?.aborted).toBe(true);
    });

    it('keeps the examples of the newer count when the older answer arrives late', async () => {
      const {
        deferred, result, startRequest
      } = renderDeferredEndpoint(useSentimentExamples);
      const newer = buildSentimentExamplesResponse({
        sentiment: 'positive',
        total: 0,
        examples: [],
      });

      startRequest((hook) => hook.fetchSentimentExamples(ALL_SCOPE, 'negative'));
      startRequest((hook) => hook.fetchSentimentExamples(ALL_SCOPE, 'positive'));
      await act(async () => {
        deferred.requests[1].respond(newer);
        deferred.requests[0].respond(EXAMPLES);
      });

      expect(result.current.data).toStrictEqual(newer);
    });
  });
});
