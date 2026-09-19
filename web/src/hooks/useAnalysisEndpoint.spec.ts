import {
  describe, it, expect, vi 
} from 'vitest';
import { act } from '@testing-library/react';
import {
  createEndpointMockFetch,
  createMockJsonResponse,
  createMockMalformedResponse,
  type EndpointMockFetchOptions,
} from '../test/fetchResponses';
import {
  renderProbeEndpoint,
  renderDeferredProbeEndpoint,
  probeResponse,
  newerProbeResponse,
  ProbeRequestError,
  type ProbeResponse,
} from './useAnalysisEndpoint-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


describe('useAnalysisEndpoint', () => {
  describe('initial state', () => {
    it('returns null data, loading false, and null error before any fetch', () => {
      const { result } = renderProbeEndpoint();

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchData', () => {
    it('stores and resolves the payload when the response passes the type guard', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse));
      const { result } = renderProbeEndpoint();

      const returned = await act(() => result.current.fetchData('best hotels'));

      expect(returned).toStrictEqual(probeResponse);
      expect(result.current.data).toStrictEqual(probeResponse);
      expect(result.current.error).toBeNull();
    });

    it('requests the built path and params against the API base URL', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse));
      const { result } = renderProbeEndpoint();

      await act(() => result.current.fetchData('best hotels'));

      expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe('https://api.test.com/probe?keyword=best+hotels');
    });

    it('passes an abort signal to authenticatedFetch', () => {
      const {
        deferred, startFetch 
      } = renderDeferredProbeEndpoint();

      startFetch('best hotels');

      expect(deferred.requests[0].signal).toBeInstanceOf(AbortSignal);
    });

    it.each<[failure: string, response: Response]>([
      ['the response status is not ok', createMockJsonResponse({}, 500)],
      ['the response body is not JSON', createMockMalformedResponse()],
    ])('sets the error state and resolves null when %s', async (_failure, response) => {
      mockAuthenticatedFetch.mockResolvedValue(response);
      const { result } = renderProbeEndpoint();

      const returned = await act(() => result.current.fetchData('best hotels'));

      expect(returned).toBeNull();
      expect(result.current.error).toBeTruthy();
      expect(result.current.data).toBeNull();
    });

    it.each<[message: string, body: string, options: EndpointMockFetchOptions<ProbeResponse>]>([
      ['probe quota exceeded', 'a backend {error} body', { errorResponse: { error: 'probe quota exceeded' } }],
      ['Invalid response format', 'a payload that fails the type guard', { invalidResponse: true }],
    ])('logs a response-factory error reading "%s" when the response is %s', async (message, _body, options) => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse, options));
      const { result } = renderProbeEndpoint();

      await act(() => result.current.fetchData('best hotels'));

      const logged = consoleErrorSpy.mock.calls[0][1] as Error;
      expect(logged).toBeInstanceOf(ProbeRequestError);
      expect(logged.message).toBe(message);
      expect(result.current.error).toBeTruthy();
    });
  });

  describe('concurrent fetches', () => {
    it('aborts the previous in-flight request when a new fetch starts', () => {
      const {
        deferred, startFetch 
      } = renderDeferredProbeEndpoint();

      startFetch('first');
      startFetch('second');

      expect(deferred.requests[0].signal?.aborted).toBe(true);
      expect(deferred.requests[1].signal?.aborted).toBe(false);
    });

    it('resolves null for the aborted fetch and leaves the error state null', async () => {
      const {
        deferred, result, startFetch 
      } = renderDeferredProbeEndpoint({ rejectOnAbort: true });

      const aborted = startFetch('first');
      startFetch('second');
      await act(async () => {
        deferred.requests[1].respond(probeResponse);
      });

      await expect(aborted).resolves.toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.data).toStrictEqual(probeResponse);
    });

    it('ignores a stale response that resolves after a newer request', async () => {
      const {
        deferred, result, startFetch 
      } = renderDeferredProbeEndpoint();

      const stale = startFetch('first');
      startFetch('second');
      await act(async () => {
        deferred.requests[1].respond(newerProbeResponse);
      });
      await act(async () => {
        deferred.requests[0].respond(probeResponse);
      });

      await expect(stale).resolves.toBeNull();
      expect(result.current.data).toStrictEqual(newerProbeResponse);
    });

    it('keeps loading set until the current request settles', async () => {
      const {
        deferred, result, startFetch 
      } = renderDeferredProbeEndpoint();

      startFetch('first');
      startFetch('second');

      await act(async () => {
        deferred.requests[0].respond(probeResponse);
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.requests[1].respond(newerProbeResponse);
      });
      expect(result.current.loading).toBe(false);
    });
  });

  describe('unmount', () => {
    it('aborts the active request when the component unmounts', () => {
      const {
        deferred, startFetch, unmount 
      } = renderDeferredProbeEndpoint();

      startFetch('best hotels');
      unmount();

      expect(deferred.requests[0].signal?.aborted).toBe(true);
    });
  });

  describe('runRequest', () => {
    it('leaves stored data untouched when a secondary request resolves', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse));
      const {
        result, config 
      } = renderProbeEndpoint();

      const returned = await act(() => result.current.runRequest({
        path: '/probe',
        params: new URLSearchParams({ keyword: 'secondary' }),
      }, config));

      expect(returned).toStrictEqual(probeResponse);
      expect(result.current.data).toBeNull();
    });

    it('aborts an in-flight secondary request when a new fetch starts', () => {
      const {
        deferred, config, startRequest, startFetch 
      } = renderDeferredProbeEndpoint();

      startRequest((hook) => hook.runRequest({ path: '/probe' }, config));
      startFetch('next');

      expect(deferred.requests[0].signal?.aborted).toBe(true);
    });
  });
});
