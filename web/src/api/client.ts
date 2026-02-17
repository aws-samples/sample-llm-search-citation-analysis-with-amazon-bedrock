/**
 * Base API client with authentication and error handling.
 */
import {
  API_BASE_URL, authenticatedFetch, ApiConfigError, ApiRequestError 
} from '../infrastructure';

// Type-safe JSON parsing - response.json() returns Promise<unknown> in strict mode
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
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
 * @param options - Optional fetch options
 * @returns Parsed JSON response
 * @throws {ApiRequestError} If request fails
 */
export async function apiGet<T>(
  endpoint: string,
  options: {
    signal?: AbortSignal;
    params?: Record<string, string> 
  } = {}
): Promise<T> {
  const {
    signal, params 
  } = options;
  
  const baseUrl = `${API_BASE_URL}${endpoint}`;
  const url = params ? `${baseUrl}?${new URLSearchParams(params)}` : baseUrl;

  const response = await authenticatedFetch(url, { signal });
  
  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated POST request to the API.
 */
export async function apiPost<T>(
  endpoint: string,
  body: unknown,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated PUT request to the API.
 */
export async function apiPut<T>(
  endpoint: string,
  body: unknown,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  return parseJsonResponse<T>(response);
}

/**
 * Makes an authenticated DELETE request to the API.
 */
export async function apiDelete<T>(
  endpoint: string,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE_URL}${endpoint}`, {
    method: 'DELETE',
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  return parseJsonResponse<T>(response);
}
/**
 * Makes an authenticated PATCH request to the API.
 */
export async function apiPatch<T>(
  endpoint: string,
  body?: unknown,
  options: { signal?: AbortSignal } = {}
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
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  return parseJsonResponse<T>(response);
}

// Re-export for use in other modules
export { parseJsonResponse };
export { ApiRequestError };
