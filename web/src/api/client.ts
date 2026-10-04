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
  acceptedJsonStatuses?: readonly number[];
}

interface ApiGetOptions extends ApiRequestOptions { params?: Record<string, string>; }

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

async function createApiRequestError(
  response: Response,
  allowStructured4xx: boolean
): Promise<ApiRequestError> {
  const decodedError = allowStructured4xx && response.status >= 400 && response.status < 500
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
    throw await createApiRequestError(response, options.allowStructured4xx === true);
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
 * Makes an authenticated GET request to the API.
 * @param endpoint - API endpoint (without base URL)
 * @param options - Optional request options
 * @returns Parsed JSON response
 * @throws {ApiRequestError} If request fails
 */
export async function apiGet<T>(
  endpoint: string,
  options: ApiGetOptions = {}
): Promise<T> {
  const {
    params, ...requestOptions
  } = options;

  const baseUrl = `${API_BASE_URL}${endpoint}`;
  const url = params ? `${baseUrl}?${new URLSearchParams(params)}` : baseUrl;

  return requestJson<T>(url, {}, requestOptions);
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
