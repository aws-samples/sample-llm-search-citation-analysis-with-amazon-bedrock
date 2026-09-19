/**
 * The behaviour every single-endpoint analysis hook shares, as one
 * parametrised suite: in-flight loading, the URL each argument combination
 * requests, storing a valid payload, reporting each failure, and clearing an
 * earlier error on a later success.
 *
 * A hook spec keeps its own idle-state test (the hook's exact surface), calls
 * `describeEndpointHookContract` inside its top-level `describe` with the
 * hook's fixtures and tables, and adds only the tests specific to that hook.
 */
import {
  describe, expect, it
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import {
  createEndpointMockFetch,
  createMockJsonResponse,
  type EndpointMockFetchOptions,
} from './fetchResponses';
import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from './infrastructureMock';

export interface EndpointHookState<TResponse> {
  readonly data: TResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/** The URL a fetch must request when called with `args`; `condition` names the case. */
export type EndpointRequestCase<TArgs extends readonly unknown[]> = [url: string, condition: string, args: TArgs];
/** A payload the hook must return and store when fetched with `args`. */
export type EndpointSuccessCase<TArgs extends readonly unknown[], TResponse> = [payload: string, response: TResponse, args: TArgs];
/** The error message the hook must report when the mocked endpoint behaves as `options` says. */
export type EndpointFailureCase<TResponse> = [message: string, failure: string, options: EndpointMockFetchOptions<TResponse>];

export interface EndpointHookContract<THook extends EndpointHookState<TResponse>, TArgs extends readonly unknown[], TResponse> {
  /** Noun used in the test names, e.g. 'citation gaps'. */
  readonly subject: string;
  readonly useHook: () => THook;
  /** Name of the hook's fetch function; titles the fetch `describe` block. */
  readonly fetchName: string;
  /** Runs the hook's fetch function. Annotate `args` so `TArgs` is the fetch signature; its result fixes `TResponse`. */
  readonly fetch: (hook: THook, ...args: TArgs) => Promise<TResponse | null>;
  /** Functions the hook returns besides `fetchName`, for the exact-state assertions. */
  readonly otherFunctions?: readonly string[];
  readonly defaultResponse: NoInfer<TResponse>;
  /** Arguments of the single fetch in the loading, failure and error-clearing tests. */
  readonly defaultArgs: NoInfer<TArgs>;
  /**
   * Arguments `authenticatedFetch` must receive for `url`. Defaults to the
   * abortable request `useAnalysisEndpoint` makes.
   */
  readonly expectedRequest?: (url: string) => readonly unknown[];
  readonly requests: ReadonlyArray<EndpointRequestCase<NoInfer<TArgs>>>;
  readonly successes: ReadonlyArray<EndpointSuccessCase<NoInfer<TArgs>, NoInfer<TResponse>>>;
  /** At least one row; the first also drives the error-clearing test. */
  readonly failures: readonly [EndpointFailureCase<NoInfer<TResponse>>, ...EndpointFailureCase<NoInfer<TResponse>>[]];
}

/** `authenticatedFetch` arguments of a request made through `useAnalysisEndpoint`. */
export function abortableRequest(url: string): readonly unknown[] {
  const signal: unknown = expect.any(AbortSignal);
  return [url, { signal }];
}

export function describeEndpointHookContract<THook extends EndpointHookState<TResponse>, TArgs extends readonly unknown[], TResponse>({
  subject,
  useHook,
  fetchName,
  fetch,
  otherFunctions = [],
  defaultResponse,
  defaultArgs,
  expectedRequest = abortableRequest,
  requests,
  successes,
  failures,
}: EndpointHookContract<THook, TArgs, TResponse>): void {
  const anyFunction: unknown = expect.any(Function);
  const hookState = (state: EndpointHookState<TResponse>): Record<string, unknown> => ({
    ...state,
    ...Object.fromEntries([fetchName, ...otherFunctions].map((name) => [name, anyFunction])),
  });

  describe(fetchName, () => {
    it(`sets loading true while the ${subject} request is in flight`, async () => {
      const deferred = deferAuthenticatedFetch();
      const { result } = renderHook(useHook);

      act(() => {
        void fetch(result.current, ...defaultArgs);
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(defaultResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each(requests)('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(defaultResponse));
      const { result } = renderHook(useHook);

      await act(() => fetch(result.current, ...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(...expectedRequest(url));
    });

    it.each(successes)(`returns and stores the %s when the response passes the ${subject} type guard`, async (_payload, response, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(response));
      const { result } = renderHook(useHook);

      const returned = await act(() => fetch(result.current, ...args));

      expect(returned).toStrictEqual(response);
      expect(result.current).toStrictEqual(hookState({
        data: response,
        loading: false,
        error: null,
      }));
    });

    it.each(failures)(`resolves null and reports "%s" when the ${subject} %s`, async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(defaultResponse, options));
      const { result } = renderHook(useHook);

      const returned = await act(() => fetch(result.current, ...defaultArgs));

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual(hookState({
        data: null,
        loading: false,
        error: message,
      }));
    });

    it(`clears the previous error when a later ${subject} fetch succeeds`, async () => {
      const [message, , failureOptions] = failures[0];
      mockAuthenticatedFetch
        .mockImplementationOnce(createEndpointMockFetch(defaultResponse, failureOptions))
        .mockImplementation(createEndpointMockFetch(defaultResponse));
      const { result } = renderHook(useHook);

      await act(() => fetch(result.current, ...defaultArgs));
      expect(result.current.error).toBe(message);

      await act(() => fetch(result.current, ...defaultArgs));
      expect(result.current.error).toBeNull();
    });
  });
}
