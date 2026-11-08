/**
 * Base API client with authentication and error handling.
 */
import {
  API_BASE_URL, authenticatedFetch, ApiConfigError, ApiRequestError 
} from '../infrastructure';
import { isRecord } from '../types/domain/keywordDecoders';

interface ApiErrorResponse {
  error: string;
  field?: string;
}

interface ApiRequestOptions {
  signal?: AbortSignal;
  allowStructured4xx?: boolean;
  /**
   * Read the `{error}` body of every non-2xx answer, 5xx included. Only for APIs whose
   * error texts are fixed server strings (the SEO API never returns provider text).
   */
  allowStructuredErrors?: boolean;
  acceptedJsonStatuses?: readonly number[];
}

interface ApiGetOptions extends ApiRequestOptions {
  params?: Record<string, string>;
  /**
   * `false` turns off the one transient-failure retry, for polling loops that
   * already retry on their next tick and count consecutive failures.
   */
  retry?: boolean;
}

// Type-safe JSON parsing - response.json() returns Promise<unknown> in strict mode
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

function decodeApiErrorResponse(data: unknown): ApiErrorResponse | null {
  // Stryker disable next-line ConditionalExpression: equivalent, a JSON non-object yields null either way (null throws into readApiErrorResponse's catch; primitives and arrays carry no string error)
  if (!isRecord(data)) return null;

  const {
    error, field
  } = data;
  if (typeof error !== 'string' || (field !== undefined && typeof field !== 'string')) return null;

  return field === undefined ? { error } : {
    error,
    field,
  };
}

async function readApiErrorResponse(response: Response): Promise<ApiErrorResponse | null> {
  try {
    const data: unknown = await response.json();
    return decodeApiErrorResponse(data);
  } catch {
    return null;
  }
}

function readsErrorBody(response: Response, options: ApiRequestOptions): boolean {
  if (options.allowStructuredErrors === true) return true;
  return options.allowStructured4xx === true && response.status >= 400 && response.status < 500;
}

async function createApiRequestError(
  response: Response,
  options: ApiRequestOptions
): Promise<ApiRequestError> {
  const decodedError = readsErrorBody(response, options)
    ? await readApiErrorResponse(response)
    : null;
  const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;

  if (decodedError === null) {
    return new ApiRequestError(fallbackMessage, { statusCode: response.status });
  }

  return new ApiRequestError(decodedError.error, {
    statusCode: response.status,
    responseMessage: decodedError.error,
    ...(decodedError.field === undefined ? {} : { field: decodedError.field }),
  });
}

function acceptsJsonStatus(response: Response, options: ApiRequestOptions): boolean {
  return options.acceptedJsonStatuses?.includes(response.status) === true;
}

/**
 * The request pipeline every verb shares: one authenticated fetch carrying the
 * caller's abort signal, an `ApiRequestError` for any unaccepted non-2xx status,
 * and the decoded JSON body otherwise.
 */
async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: ApiRequestOptions
): Promise<T> {
  const response = await authenticatedFetch(url, {
    ...init,
    signal: options.signal,
  });

  if (!response.ok && !acceptsJsonStatus(response, options)) {
    throw await createApiRequestError(response, options);
  }

  return parseJsonResponse<T>(response);
}

function jsonBodyRequest(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function requestEndpoint<T>(endpoint: string, init: RequestInit, options: ApiRequestOptions): Promise<T> {
  return requestJson<T>(`${API_BASE_URL}${endpoint}`, init, options);
}

/**
 * Validates that the API is properly configured.
 * @throws {ApiConfigError} If API URL contains placeholder or is not set
 */
export function validateApiConfig(): void {
  if (API_BASE_URL.includes('PLACEHOLDER')) {
    throw new ApiConfigError(
      'API URL not configured. Please set VITE_API_URL environment variable or deploy the application.'
    );
  }
}

/**
 * Statuses a GET is retried on once: cold-start and throttle blips (502, 503,
 * 429). 504 is deliberately absent: API Gateway gave up after 29 s, and the
 * same query would take another 29 s and read the same rows again.
 */
const RETRYABLE_GET_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

/**
 * The retry waits a random 300–811 ms so a burst of failed panels does not
 * retry in lockstep: 300 ms plus 9 random bits (masking a power-of-two range
 * keeps every wait equally likely, which dividing or rounding would not).
 */
export const GET_RETRY_DELAY_MIN_MS = 300;
const GET_RETRY_JITTER_BITS = 9;
export const GET_RETRY_DELAY_MAX_MS = GET_RETRY_DELAY_MIN_MS + (1 << GET_RETRY_JITTER_BITS) - 1;

function retryDelayMs(): number {
  const [draw = 0] = crypto.getRandomValues(new Uint16Array(1));
  return GET_RETRY_DELAY_MIN_MS + (draw & (GET_RETRY_DELAY_MAX_MS - GET_RETRY_DELAY_MIN_MS));
}

/** A transport failure (`fetch` rejects with a TypeError) or a retryable status. */
function isRetryableGetFailure(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.statusCode !== undefined && RETRYABLE_GET_STATUSES.has(error.statusCode);
  }
  return error instanceof TypeError;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
function waitBeforeRetry(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      if (signal !== undefined) reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Makes an authenticated GET request to the API.
 *
 * A GET is idempotent, so a 502, 503, 429 or network failure is retried once
 * after a jittered 300–811 ms wait. A 504 and every other status fail at once,
 * and an aborted request is never retried.
 * @param endpoint - API endpoint (without base URL)
 * @param options - Optional request options
 * @returns Parsed JSON response
 * @throws {ApiRequestError} If request fails
 */
export async function apiGet<T>(
  endpoint: string,
  options: ApiGetOptions = {}
): Promise<T> {
  return apiGetFrom<T>(API_BASE_URL, endpoint, options);
}

/**
 * `apiGet` against another API of this deployment (e.g. the SEO stack's), with
 * the same authentication and error handling.
 */
export async function apiGetFrom<T>(
  baseUrl: string,
  endpoint: string,
  options: ApiGetOptions = {}
): Promise<T> {
  const {
    params, retry = true, ...requestOptions
  } = options;

  const endpointUrl = `${baseUrl}${endpoint}`;
  const url = params ? `${endpointUrl}?${new URLSearchParams(params)}` : endpointUrl;

  try {
    return await requestJson<T>(url, {}, requestOptions);
  } catch (firstError) {
    if (!retry || requestOptions.signal?.aborted === true || !isRetryableGetFailure(firstError)) throw firstError;
    await waitBeforeRetry(retryDelayMs(), requestOptions.signal);
    return requestJson<T>(url, {}, requestOptions);
  }
}

/** `apiPost` against another API of this deployment (see `apiGetFrom`). */
export async function apiPostTo<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  return requestJson<T>(`${baseUrl}${endpoint}`, jsonBodyRequest('POST', body), options);
}

/** A PUT or DELETE against another API of this deployment (see `apiGetFrom`); DELETE sends no body. */
export async function apiSendTo<T>(
  baseUrl: string,
  method: 'PUT' | 'DELETE',
  endpoint: string,
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const init = method === 'PUT' ? jsonBodyRequest('PUT', body) : { method };
  return requestJson<T>(`${baseUrl}${endpoint}`, init, options);
}

/** An authenticated request with a JSON body, for the verbs that carry one. */
function jsonBodyVerb(method: 'POST' | 'PUT') {
  return async function sendJsonBody<T>(
    endpoint: string,
    body: unknown,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    return requestEndpoint<T>(endpoint, jsonBodyRequest(method, body), options);
  };
}

/**
 * Makes an authenticated POST request to the API.
 */
export const apiPost = jsonBodyVerb('POST');

/**
 * Makes an authenticated PUT request to the API.
 */
export const apiPut = jsonBodyVerb('PUT');

/**
 * Makes an authenticated DELETE request to the API.
 */
export async function apiDelete<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  return requestEndpoint<T>(endpoint, { method: 'DELETE' }, options);
}
