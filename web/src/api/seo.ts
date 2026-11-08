/**
 * SEO API client: the routes of `CitationAnalysisSeoStack`
 * under `${SEO_API_BASE_URL}/seo/...`.
 *
 * Requests carry the same Cognito ID token and raise the same `ApiRequestError`
 * as the main API client (`./client`). The SEO API's error texts are fixed
 * server strings (`lambda/seo/seo_http.py`, never the provider's own text), so
 * its `{error}` body is read for 5xx answers too and `seoErrorMessage` shows it.
 * Every response is checked by the guards of `./seoDecoders`.
 *
 * Paid routes (`researchKeywords`, `fetchSerp`) are never retried here: a
 * timed-out paid call may already be billed. The metrics routes
 * (`/keywords/metrics`, `/keywords/metrics/lookup`) serve the MCP tools; the
 * dashboard has no client for them because research already stores the
 * metrics of the rows it returns.
 */
import {
  seoGet, seoPost, type SeoRequestOptions
} from './seoRequest';
import {
  InvalidSeoResponseError,
  decodeSeo,
  isKeywordResearchResponse,
  isSeoAccount,
  isSeoGeoResponse,
  isSerpResponse,
} from './seoDecoders';
import { SEO_API_BASE_URL } from '../infrastructure/config';
import {
  ApiRequestError, getErrorMessage
} from '../infrastructure';
import type {
  KeywordResearchRequest,
  KeywordResearchResponse,
  SeoAccount,
  SeoGeoResponse,
  SerpRequest,
  SerpResponse,
} from '../types/api/seo';

export const UNEXPECTED_ANSWER_MESSAGE = 'The SEO API sent an unexpected answer. Try again later.';

/** Whether the SEO stack is deployed (its API URL was built into the dashboard). */
export function isSeoApiConfigured(): boolean {
  return SEO_API_BASE_URL !== '';
}

export async function researchKeywords(
  request: KeywordResearchRequest, options: SeoRequestOptions = {}
): Promise<KeywordResearchResponse> {
  const payload = await seoPost('/keywords/research', request, options);
  return decodeSeo(payload, isKeywordResearchResponse, 'keyword research');
}

export async function fetchSerp(request: SerpRequest, options: SeoRequestOptions = {}): Promise<SerpResponse> {
  const payload = await seoPost('/serp', request, options);
  return decodeSeo(payload, isSerpResponse, 'search results page');
}

export async function fetchSeoAccount(options: SeoRequestOptions = {}): Promise<SeoAccount> {
  const payload = await seoGet('/account', {}, options);
  return decodeSeo(payload, isSeoAccount, 'account');
}

export async function fetchSeoGeo(
  params: {
    market_id?: string;
    group_id?: string 
  }, options: SeoRequestOptions = {}
): Promise<SeoGeoResponse> {
  const payload = await seoGet('/seo-geo', params, options);
  return decodeSeo(payload, isSeoGeoResponse, 'SEO vs GEO report');
}

/**
 * The text to show for a failed SEO request: the SEO API's own message when it
 * sent one (any status), the shared generic message otherwise.
 */
export function seoErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.responseMessage !== undefined) {
    return error.responseMessage;
  }
  if (error instanceof InvalidSeoResponseError) return UNEXPECTED_ANSWER_MESSAGE;
  return getErrorMessage(error);
}
