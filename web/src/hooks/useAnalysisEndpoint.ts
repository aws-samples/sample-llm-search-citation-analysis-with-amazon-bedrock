import {
  useCallback, useState
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  isAbortError,
} from '../infrastructure';
import { useLatestRequest } from './useLatestRequest';

/**
 * Error payload the analysis API returns with HTTP 200 for domain
 * errors (missing brand config, unknown keyword, ...).
 */
export interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  // Optional chaining makes this safe for null, primitives and arrays without
  // the `typeof data === 'object' && data !== null && 'error' in data` guard,
  // whose clauses were each redundant with this one comparison.
  return typeof (data as Partial<BackendErrorResponse> | null)?.error === 'string';
}

/** Request target built from a fetch function's arguments. */
export interface AnalysisRequest {
  path: string;
  params?: URLSearchParams;
  init?: RequestInit;
}

/**
 * How one endpoint's response body is validated and how its failures
 * are wrapped, so each hook keeps its own error class, messages, and
 * console tag.
 */
export interface AnalysisResponseContract<TResponse> {
  isValidResponse: (data: unknown) => data is TResponse;
  createHttpError: (status: number) => Error;
  createResponseError: (message: string) => Error;
  logMessage: string;
  /**
   * When false, a 200 body shaped like `{error}` is left to the
   * endpoint's own type guard instead of being rejected up front.
   * Defaults to true.
   */
  rejectBackendErrorBody?: boolean;
}

export interface AnalysisEndpointConfig<TArgs extends readonly unknown[], TResponse> extends AnalysisResponseContract<TResponse> {
  buildRequest: (...args: TArgs) => AnalysisRequest;
  errorContext: string;
}

/**
 * Performs one analysis request and returns its validated body. Throws the
 * contract's own errors on a non-OK status, a 200 `{error}` body (unless the
 * contract opts out) and a body its type guard rejects; the caller owns the
 * abort, staleness and state-write decisions.
 */
async function fetchAnalysisResponse<TResult>(
  request: AnalysisRequest,
  contract: AnalysisResponseContract<TResult>,
  signal: AbortSignal,
): Promise<TResult> {
  const query = request.params ? `?${request.params.toString()}` : '';
  const response = await authenticatedFetch(`${API_BASE_URL}${request.path}${query}`, {
    ...request.init,
    signal,
  });
  if (!response.ok) throw contract.createHttpError(response.status);

  const json: unknown = await response.json();
  if ((contract.rejectBackendErrorBody ?? true) && isBackendErrorResponse(json)) {
    throw contract.createResponseError(json.error);
  }
  if (!contract.isValidResponse(json)) {
    throw contract.createResponseError('Invalid response format');
  }
  return json;
}

/**
 * Shared fetch machinery for the imperative dashboard analysis hooks
 * (visibility, trends, citation gaps, persona rankings, competitor
 * rollup, reports overview, self-reflection, prompt insights).
 *
 * Owns the `data`/`loading`/`error` state triple and uses
 * `useLatestRequest` for its concurrency guarantees:
 * - each fetch aborts the previous in-flight request and passes the signal
 *   to `authenticatedFetch`;
 * - request generations guard every state write, so a response that ignores
 *   the abort can never overwrite newer results;
 * - unmount aborts the active request and blocks further state writes;
 * - an aborted fetch resolves null without touching the error state;
 * - `loading` only clears when the current request settles.
 *
 * Pass a module-level config object so the returned callbacks keep a
 * stable identity across renders (consumers list them in effect deps).
 *
 * @returns `data`, `loading`, `error`, the configured `fetchData`, and
 * `runRequest` for hooks that expose a second operation sharing the
 * same state and abort machinery.
 */
export function useAnalysisEndpoint<TArgs extends readonly unknown[], TResponse>(config: AnalysisEndpointConfig<TArgs, TResponse>) {
  const [data, setData] = useState<TResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    beginRequest, isMounted
  } = useLatestRequest();
  const { errorContext } = config;

  // Stryker disable ArrayDeclaration: React dependency list, not behaviour
  const runRequest = useCallback(async <TResult>(
    request: AnalysisRequest,
    contract: AnalysisResponseContract<TResult>,
    applyResult?: (result: TResult) => void,
  ): Promise<TResult | null> => {
    if (!isMounted()) return null;

    const latestRequest = beginRequest();
    setLoading(true);
    setError(null);

    try {
      const json = await fetchAnalysisResponse(request, contract, latestRequest.signal);
      if (!latestRequest.isCurrent()) return null;
      applyResult?.(json);
      return json;
    } catch (err) {
      if (isAbortError(err)) return null;
      console.error(contract.logMessage, err);
      if (latestRequest.isCurrent()) {
        setError(getErrorMessage(err, errorContext));
      }
      return null;
    } finally {
      if (latestRequest.isCurrent()) setLoading(false);
      latestRequest.finish();
    }
  }, [beginRequest, errorContext, isMounted]);
  // Stryker restore ArrayDeclaration

  const fetchData = useCallback(
    (...args: TArgs) => runRequest(config.buildRequest(...args), config, result => {
      setData(result);
    }),
    // Stryker disable next-line ArrayDeclaration: React dependency list, not behaviour
    [config, runRequest],
  );

  return {
    data,
    loading,
    error,
    fetchData,
    runRequest,
  };
}
