import {
  useCallback, useState
} from 'react';
import {
  API_BASE_URL,
  ApiRequestError,
  authenticatedFetch,
  getErrorMessage,
  isAbortError,
} from '../infrastructure';
import { isRecord } from '../types/domain/keywordDecoders';
import { useLatestRequest } from './useLatestRequest';
import { useRequestStatus } from './useRequestStatus';

/**
 * Error payload the analysis API returns with HTTP 200 for domain
 * errors (missing brand config, unknown keyword, ...).
 */
interface BackendErrorResponse {error: string;}

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
  /**
   * How the endpoint says "no AI answers for this scope yet": an HTTP status
   * (`/brand-mentions` answers 404 for a keyword with no run) or a 200
   * `{error}` message (`/citation-gaps`). Either one settles the request as
   * `noData` instead of an error; every other failure stays an error.
   */
  noData?: NoDataSignal;
}

interface NoDataSignal {
  readonly status?: number;
  readonly errorMessage?: RegExp;
}

/** The value `fetchAnalysisResponse` resolves to when the endpoint reported no data yet. */
const NO_DATA = Symbol('no data yet');

/** The payload the last request stored, or its "no data yet" verdict (then `data` is null). */
interface SettledOutcome<TResponse> {
  readonly data: TResponse | null;
  readonly noData: boolean;
}

const NOTHING_SETTLED: SettledOutcome<never> = {
  data: null,
  noData: false
};
const NO_DATA_SETTLED: SettledOutcome<never> = {
  data: null,
  noData: true
};

export interface AnalysisEndpointConfig<TArgs extends readonly unknown[], TResponse> extends AnalysisResponseContract<TResponse> {
  buildRequest: (...args: TArgs) => AnalysisRequest;
  errorContext: string;
}

type ContractErrors = Pick<AnalysisResponseContract<unknown>, 'createHttpError' | 'createResponseError'>;

/** Failures as `ApiRequestError`: a non-OK status gets `httpMessage` and the status code. */
export function apiRequestErrors(httpMessage: string): ContractErrors {
  return {
    createHttpError: (status: number) => new ApiRequestError(httpMessage, status),
    createResponseError: (message: string) => new ApiRequestError(message),
  };
}

/**
 * A failed-request error class named `name` (`VisibilityFetchError`): the
 * class is defined under that key, so its constructor name and `name` agree
 * as the hand-written per-hook classes did.
 */
function namedFetchError(name: string) {
  return {
    [name]: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = name;
      }
    },
  }[name];
}

/** Failures named `name`: `defaultMessage` for a non-OK status, the body's message otherwise. */
export function fetchErrors(name: string, defaultMessage: string): ContractErrors {
  const errorClass = namedFetchError(name);
  return {
    createHttpError: () => new errorClass(defaultMessage),
    createResponseError: (message: string) => new errorClass(message),
  };
}

/** A JSON object that is not an `{error}` body: where every analysis response guard starts. */
export function isAnalysisPayload(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && !('error' in data);
}

/** Query parameters plus the optional brand and persona (query prompt) filters, when set. */
export function brandFilterParams(
  base: Record<string, string>,
  brand?: string,
  queryPromptId?: string
): URLSearchParams {
  const params = new URLSearchParams(base);
  if (brand) params.append('brand', brand);
  if (queryPromptId) params.append('query_prompt_id', queryPromptId);
  return params;
}

/**
 * Performs one analysis request and returns its validated body, or `NO_DATA`
 * when the contract's `noData` signal matches. Throws the
 * contract's own errors on a non-OK status, a 200 `{error}` body (unless the
 * contract opts out) and a body its type guard rejects; the caller owns the
 * abort, staleness and state-write decisions.
 */
async function fetchAnalysisResponse<TResult>(
  request: AnalysisRequest,
  contract: AnalysisResponseContract<TResult>,
  signal: AbortSignal,
): Promise<TResult | typeof NO_DATA> {
  const query = request.params ? `?${request.params.toString()}` : '';
  const response = await authenticatedFetch(`${API_BASE_URL}${request.path}${query}`, {
    ...request.init,
    signal,
  });
  if (!response.ok) {
    if (response.status === contract.noData?.status) return NO_DATA;
    throw contract.createHttpError(response.status);
  }
  const json: unknown = await response.json();
  if (isNoDataBody(json, contract)) return NO_DATA;
  return validatedBody(json, contract);
}

/** A 200 `{error}` body whose message is the endpoint's "no data yet" signal. */
function isNoDataBody(json: unknown, contract: AnalysisResponseContract<unknown>): boolean {
  return isBackendErrorResponse(json) && contract.noData?.errorMessage?.test(json.error) === true;
}

/** The payload, or the contract's error for a rejected `{error}` body or one the type guard refuses. */
function validatedBody<TResult>(json: unknown, contract: AnalysisResponseContract<TResult>): TResult {
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
 * @returns `data`, `loading`, `error`, the configured `fetchData` and `reset`.
 */
export function useAnalysisEndpoint<TArgs extends readonly unknown[], TResponse>(config: AnalysisEndpointConfig<TArgs, TResponse>) {
  // The payload and the "no data yet" flag change together, in one update,
  // so no render can show a payload under a "no data yet" verdict or the reverse.
  const [outcome, setOutcome] = useState<SettledOutcome<TResponse>>(NOTHING_SETTLED);
  const {
    loading, setLoading, error, setError 
  } = useRequestStatus();
  const {
    beginRequest, isMounted, cancelRequest
  } = useLatestRequest();
  const { errorContext } = config;

  // Stryker disable ArrayDeclaration: React dependency list, not behaviour
  const runRequest = useCallback(async <TResult>(
    request: AnalysisRequest,
    contract: AnalysisResponseContract<TResult>,
    applyResult: (result: TResult) => void,
  ): Promise<TResult | null> => {
    if (!isMounted()) return null;

    const latestRequest = beginRequest();
    setLoading(true);
    setError(null);
    // A refetch keeps an earlier payload on screen, but not an earlier "no data yet".
    setOutcome(previous => (previous.noData ? NOTHING_SETTLED : previous));

    try {
      const json = await fetchAnalysisResponse(request, contract, latestRequest.signal);
      if (!latestRequest.isCurrent()) return null;
      if (json === NO_DATA) {
        // Not a failure: the scope has no analysed answers yet. Earlier data is
        // dropped so the view cannot show another scope's results under it.
        setOutcome(NO_DATA_SETTLED);
        return null;
      }
      applyResult(json);
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
      setOutcome({
        data: result,
        noData: false
      });
    }),
    // Stryker disable next-line ArrayDeclaration: React dependency list, not behaviour
    [config, runRequest],
  );

  // Stryker disable next-line ArrayDeclaration: React dependency list, not behaviour
  const reset = useCallback((): void => {
    // The dropped request's own settle no longer clears loading (it is not current), so clear it here.
    cancelRequest();
    setOutcome(NOTHING_SETTLED);
    setLoading(false);
    setError(null);
  }, [cancelRequest]);

  return {
    data: outcome.data,
    loading,
    error,
    /** The last request settled with "no AI answers for this scope yet" (see `noData` in the config): `data` and `error` are null. */
    noData: outcome.noData,
    fetchData,
    /** Back to the idle state: the request in flight is dropped, `data` and `error` cleared. */
    reset,
  };
}
