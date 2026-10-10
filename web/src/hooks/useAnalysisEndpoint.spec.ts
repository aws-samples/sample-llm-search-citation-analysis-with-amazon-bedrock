import {
  describe, it, expect, vi 
} from 'vitest';
import { act } from '@testing-library/react';
import {
  createMockJsonResponse,
  createMockMalformedResponse,
  type EndpointMockFetchOptions,
} from '../test/fetchResponses';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  renderProbeEndpoint,
  renderAnsweringProbeEndpoint,
  renderFetchedProbeEndpoint,
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
  /** The exact state before any fetch and again after `reset`. */
  const IDLE_STATE = idleEndpointState('fetchData', 'reset');

  describe('initial state', () => {
    it('returns null data, loading false, and null error before any fetch', () => {
      const { result } = renderProbeEndpoint();

      expect(result.current).toStrictEqual(IDLE_STATE);
    });
  });

  describe('fetchData', () => {
    it('stores and resolves the payload when the response passes the type guard', async () => {
      const {
        returned, result
      } = await renderFetchedProbeEndpoint();

      expect(returned).toStrictEqual(probeResponse);
      expect(result.current.data).toStrictEqual(probeResponse);
      expect(result.current.error).toBeNull();
    });

    it('requests the built path and params against the API base URL', async () => {
      await renderFetchedProbeEndpoint();

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
      const {
        returned, result
      } = await renderFetchedProbeEndpoint(response);

      expect(returned).toBeNull();
      expect(result.current.error).toBe(errorState);
      expect(result.current.data).toBeNull();
    });

    it.each<[message: string, body: string, options: EndpointMockFetchOptions<ProbeResponse>, errorState: string]>([
      ['probe quota exceeded', 'a backend {error} body', { errorResponse: { error: 'probe quota exceeded' } }, 'Failed to load visibility metrics'],
      ['Invalid response format', 'a payload that fails the type guard', { invalidResponse: true }, 'Invalid visibility request'],
    ])('logs a response-factory error reading "%s" when the response is %s', async (message, _body, options, errorState) => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const { result } = await renderFetchedProbeEndpoint(options);

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
        stale, respondTo, result
      } = await renderSupersededFetch();

      await respondTo(0, probeResponse);

      await expect(stale).resolves.toBeNull();
      expect(result.current.data).toStrictEqual(newerProbeResponse);
    });

    it('ignores a stale failure that lands after a newer request succeeded', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      const {
        stale, respondTo, result
      } = await renderSupersededFetch();

      await respondTo(0, {}, 500);

      await expect(stale).resolves.toBeNull();
      expect(result.current.error).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('[probe] Error fetching probe results:', expect.any(Error));
    });

    it('keeps loading set until the current request settles', async () => {
      const {
        respondTo, result, startFetch
      } = renderDeferredProbeEndpoint();

      startFetch('first');
      startFetch('second');

      await respondTo(0, probeResponse);
      expect(result.current.loading).toBe(true);

      await respondTo(1, newerProbeResponse);
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
      const {
        result, unmount
      } = renderAnsweringProbeEndpoint();
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
      const { result } = renderAnsweringProbeEndpoint({}, { paramless: true });

      await act(() => result.current.fetchData('best hotels'));

      expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe('https://api.test.com/probe');
    });
  });

  describe('reset', () => {
    it.each<[outcome: string, answer: Response | EndpointMockFetchOptions<ProbeResponse>]>([
      ['stored a payload', {}],
      ['failed', createMockJsonResponse({}, 500)],
    ])('returns to the idle state after a fetch %s', async (_outcome, answer) => {
      const { result } = await renderFetchedProbeEndpoint(answer);

      act(() => {
        result.current.reset();
      });

      expect(result.current).toStrictEqual(IDLE_STATE);
    });

    it('aborts the request in flight and drops its answer', async () => {
      const {
        deferred, startFetch, respondTo, result
      } = renderDeferredProbeEndpoint();
      const dropped = startFetch('best hotels');

      act(() => {
        result.current.reset();
      });
      await respondTo(0, probeResponse);

      expect(deferred.requests[0].signal?.aborted).toBe(true);
      await expect(dropped).resolves.toBeNull();
      expect(result.current).toStrictEqual(IDLE_STATE);
    });
  });
});
