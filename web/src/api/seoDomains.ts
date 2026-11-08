/**
 * Domain Overview and SEO recommendations client (`${SEO_API_BASE_URL}/seo/domains/...`, `/seo/insights`).
 *
 * The four lookups (`fetchDomainOverview`, `fetchDomainKeywords`, `fetchDomainPages`,
 * `fetchSerpCompetitors`) are paid DataForSEO Labs calls: callers run them only
 * on an explicit user action, and nothing here retries them (a timed-out call
 * may already be billed). Snapshots and recommendations are reads of stored
 * data; `takeDomainSnapshot` (Admin) starts one paid snapshot job.
 */
import {
  seoGet, seoPost, type SeoRequestOptions
} from './seoRequest';
import { decodeSeo } from './seoDecoders';
import {
  isDomainKeywordsResponse,
  isDomainOverviewResponse,
  isDomainPagesResponse,
  isDomainSnapshotsResponse,
  isSeoInsightsResponse,
  isSerpCompetitorsResponse,
  isTakeSnapshotResponse,
} from './seoDomainsDecoders';
import type {
  DomainKeywordsRequest,
  DomainKeywordsResponse,
  DomainOverviewResponse,
  DomainPagesRequest,
  DomainPagesResponse,
  DomainSnapshotsResponse,
  DomainTargetRequest,
  SeoInsightsResponse,
  SerpCompetitorsRequest,
  SerpCompetitorsResponse,
  TakeSnapshotResponse,
} from '../types/api/seoDomains';

export async function fetchDomainOverview(
  request: DomainTargetRequest, options: SeoRequestOptions = {}
): Promise<DomainOverviewResponse> {
  return decodeSeo(await seoPost('/domains/overview', request, options), isDomainOverviewResponse, 'domain overview');
}

export async function fetchDomainKeywords(
  request: DomainKeywordsRequest, options: SeoRequestOptions = {}
): Promise<DomainKeywordsResponse> {
  return decodeSeo(await seoPost('/domains/keywords', request, options), isDomainKeywordsResponse, 'ranked keywords page');
}

export async function fetchDomainPages(
  request: DomainPagesRequest, options: SeoRequestOptions = {}
): Promise<DomainPagesResponse> {
  return decodeSeo(await seoPost('/domains/pages', request, options), isDomainPagesResponse, 'top pages page');
}

export async function fetchSerpCompetitors(
  request: SerpCompetitorsRequest, options: SeoRequestOptions = {}
): Promise<SerpCompetitorsResponse> {
  return decodeSeo(await seoPost('/domains/competitors', request, options), isSerpCompetitorsResponse, 'SERP competitors');
}

export async function fetchDomainSnapshots(
  params: {
    domain: string;
    market_id?: string;
  }, options: SeoRequestOptions = {}
): Promise<DomainSnapshotsResponse> {
  return decodeSeo(await seoGet('/domains/snapshots', params, options), isDomainSnapshotsResponse, 'domain snapshots');
}

export async function takeDomainSnapshot(
  request: {
    domain: string;
    market_id?: string;
  }, options: SeoRequestOptions = {}
): Promise<TakeSnapshotResponse> {
  return decodeSeo(await seoPost('/domains/snapshots', request, options), isTakeSnapshotResponse, 'snapshot start');
}

export async function fetchSeoInsights(
  params: {
    market_id?: string;
    group_id?: string;
  }, options: SeoRequestOptions = {}
): Promise<SeoInsightsResponse> {
  return decodeSeo(await seoGet('/insights', params, options), isSeoInsightsResponse, 'SEO recommendations');
}
