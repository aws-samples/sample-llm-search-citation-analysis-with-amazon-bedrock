/**
 * Base API client with authentication and error handling.
 */
import {
  API_BASE_URL, authenticatedFetch, ApiConfigError, ApiRequestError 
} from '../infrastructure';

interface ApiErrorResponse {
  error: string;
  field?: string;
}

interface ApiRequestOptions {
  signal?: AbortSignal;
  allowStructured4xx?: boolean;
}

interface ApiGetOptions extends ApiRequestOptions { params?: Record<string, string>; }

// Type-safe JSON parsing - response.json() returns Promise<unknown> in strict mode
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

function isJsonObject(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function decodeApiErrorResponse(data: unknown): ApiErrorResponse | null {
  if (!isJsonObject(data)) return null;

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
    signal, params, allowStructured4xx
  } = options;
  
  const baseUrl = `${API_BASE_URL}${endpoint}`;
  const url = params ? `${baseUrl}?${new URLSearchParams(params)}` : baseUrl;

  const response = await authenticatedFetch(url, { signal });
  
  if (!response.ok) {
    throw await createApiRequestError(response, allowStructured4xx === true);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated POST request to the API.
 */
export async function apiPost<T>(
  endpoint: string,
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createApiRequestError(response, options.allowStructured4xx === true);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated PUT request to the API.
 */
export async function apiPut<T>(
  endpoint: string,
  body: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createApiRequestError(response, options.allowStructured4xx === true);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated DELETE request to the API.
 */
export async function apiDelete<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'DELETE',
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createApiRequestError(response, options.allowStructured4xx === true);
  }

  return parseJsonResponse<T>(response);
}
/**
 * Makes an authenticated PATCH request to the API.
 */
export async function apiPatch<T>(
  endpoint: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const fetchOptions: RequestInit = {
    method: 'PATCH',
    signal: options.signal,
  };

  if (body !== undefined) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, fetchOptions);

  if (!response.ok) {
    throw await createApiRequestError(response, options.allowStructured4xx === true);
  }

  return parseJsonResponse<T>(response);
}

// Re-export for use in other modules
export { parseJsonResponse };
export { ApiRequestError };
