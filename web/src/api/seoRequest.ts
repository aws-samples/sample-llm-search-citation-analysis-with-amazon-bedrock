/**
 * The four verbs of the SEO API (`${SEO_API_BASE_URL}/seo/...`), shared by every SEO feature client.
 *
 * Same Cognito ID token and `ApiRequestError` as the main API client; the
 * SEO API's `{error}` body is read for 5xx answers too (its texts are fixed
 * server strings, never the provider's own). Responses come back as `unknown`:
 * every caller decodes them with its own hand-written guards. Nothing here
 * retries: a timed-out paid call may already be billed.
 */
import {
  apiGetFrom, apiPostTo, apiSendTo
} from './client';
import { SEO_API_BASE_URL } from '../infrastructure/config';

export interface SeoRequestOptions {signal?: AbortSignal;}

const SEO_ERROR_OPTIONS = { allowStructuredErrors: true } satisfies { allowStructuredErrors: boolean };

/** GET `/seo${endpoint}`; `params` with an empty or missing value are left out of the query. */
export function seoGet(
  endpoint: string, params: Record<string, string | undefined> = {}, options: SeoRequestOptions = {}
): Promise<unknown> {
  const query = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
  return apiGetFrom<unknown>(SEO_API_BASE_URL, `/seo${endpoint}`, {
    ...SEO_ERROR_OPTIONS,
    signal: options.signal,
    ...(Object.keys(query).length > 0 ? { params: query } : {}),
  });
}

/** POST a JSON body to `/seo${endpoint}`. */
export function seoPost(endpoint: string, body: unknown, options: SeoRequestOptions = {}): Promise<unknown> {
  return apiPostTo<unknown>(SEO_API_BASE_URL, `/seo${endpoint}`, body, {
    ...SEO_ERROR_OPTIONS,
    signal: options.signal,
  });
}

/** PUT a JSON body to, or DELETE, `/seo${endpoint}`. */
export function seoSend(
  method: 'PUT' | 'DELETE', endpoint: string, body: unknown = null, options: SeoRequestOptions = {}
): Promise<unknown> {
  return apiSendTo<unknown>(SEO_API_BASE_URL, method, `/seo${endpoint}`, body, {
    ...SEO_ERROR_OPTIONS,
    signal: options.signal,
  });
}
