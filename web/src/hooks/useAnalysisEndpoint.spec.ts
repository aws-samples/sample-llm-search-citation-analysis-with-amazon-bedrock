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
  renderSupersededFetch,
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

      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: null,
        fetchData: expect.any(Function),
        runRequest: expect.any(Function),
      });
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

    it.each<[failure: string, response: Response, errorState: string]>([
      ['the response status is not ok', createMockJsonResponse({}, 500), 'Unable to load visibility metrics'],
      ['the response body is not JSON', createMockMalformedResponse(), 'Failed to load visibility metrics'],
      ['the body is a JSON null', createMockJsonResponse(null), 'Invalid visibility request'],
      ['the body is a JSON number', createMockJsonResponse(42), 'Invalid visibility request'],
      ['the body is a JSON array', createMockJsonResponse([probeResponse]), 'Invalid visibility request'],
    ])('sets the error state and resolves null when %s', async (_failure, response, errorState) => {
      mockAuthenticatedFetch.mockResolvedValue(response);
      const { result } = renderProbeEndpoint();

      const returned = await act(() => result.current.fetchData('best hotels'));

      expect(returned).toBeNull();
      expect(result.current.error).toBe(errorState);
      expect(result.current.data).toBeNull();
    });

    it.each<[message: string, body: string, options: EndpointMockFetchOptions<ProbeResponse>, errorState: string]>([
      ['probe quota exceeded', 'a backend {error} body', { errorResponse: { error: 'probe quota exceeded' } }, 'Failed to load visibility metrics'],
      ['Invalid response format', 'a payload that fails the type guard', { invalidResponse: true }, 'Invalid visibility request'],
    ])('logs a response-factory error reading "%s" when the response is %s', async (message, _body, options, errorState) => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse, options));
      const { result } = renderProbeEndpoint();

      await act(() => result.current.fetchData('best hotels'));

      const logged = consoleErrorSpy.mock.calls[0][1] as Error;
      expect(logged).toBeInstanceOf(ProbeRequestError);
      expect(logged.message).toBe(message);
      expect(result.current.error).toBe(errorState);
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
        stale, result 
      } = await renderSupersededFetch({
        rejectOnAbort: true,
        payload: probeResponse 
      });

      await expect(stale).resolves.toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.data).toStrictEqual(probeResponse);
    });

    it('does not log an aborted request as an error', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const { stale } = await renderSupersededFetch({ rejectOnAbort: true });

      await expect(stale).resolves.toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('ignores a stale response that resolves after a newer request', async () => {
      const {
        stale, deferred, result 
      } = await renderSupersededFetch();

      await act(async () => {
        deferred.requests[0].respond(probeResponse);
      });

      await expect(stale).resolves.toBeNull();
      expect(result.current.data).toStrictEqual(newerProbeResponse);
    });

    it('ignores a stale failure that lands after a newer request succeeded', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const {
        stale, deferred, result 
      } = await renderSupersededFetch();

      await act(async () => {
        deferred.requests[0].respond({}, 500);
      });

      await expect(stale).resolves.toBeNull();
      expect(result.current.error).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('[probe] Error fetching probe results:', expect.any(Error));
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

    it('resolves null without calling the API when fetching after unmount', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse));
      const {
        result, unmount 
      } = renderProbeEndpoint();
      unmount();

      const returned = await result.current.fetchData('best hotels');

      expect(returned).toBeNull();
      expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
    });

    it('resolves null when the response lands after the component unmounted', async () => {
      const {
        deferred, startFetch, unmount 
      } = renderDeferredProbeEndpoint();
      const pending = startFetch('best hotels');
      unmount();

      deferred.requests[0].respond(probeResponse);

      expect(await pending).toBeNull();
    });
  });

  describe('request shape', () => {
    it('sends no query string when the request has no params', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(probeResponse));
      const {
        result, config 
      } = renderProbeEndpoint();

      await act(() => result.current.runRequest({ path: '/probe' }, config));

      expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe('https://api.test.com/probe');
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
