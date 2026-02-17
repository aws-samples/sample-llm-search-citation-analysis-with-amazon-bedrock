/**
 * Raw responses (S3) API client functions.
 */
import { apiGet } from './client';
import type {
  S3BrowseResponse, RawResponseContent 
} from '../types';

/**
 * Browses raw response files in S3.
 */
export function browseRawResponses(
  prefix: string,
  signal?: AbortSignal
): Promise<S3BrowseResponse> {
  return apiGet<S3BrowseResponse>('/raw-responses/browse', {
    params: { prefix },
    signal,
  });
}

/**
 * Fetches a raw response file content.
 */
export function fetchRawResponseFile(
  key: string,
  signal?: AbortSignal
): Promise<RawResponseContent> {
  return apiGet<RawResponseContent>('/raw-responses/file', {
    params: { key },
    signal,
  });
}

/**
 * Gets a download URL for a raw response file.
 */
export async function downloadRawResponse(
  key: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await apiGet<{ url: string }>('/raw-responses/download', {
    params: { key },
    signal,
  });
  return response.url;
}
