/**
 * Site audit API client: `${SEO_API_BASE_URL}/seo/audits...` (`lambda/seo/seo-audits.py`).
 *
 * Starting and cancelling are Admin routes; reading is open to every signed-in
 * user. No route calls a paid API, so the reads are safe to poll; nothing here
 * retries. Every response is checked by the guards of `./seoAuditsDecoders`.
 */
import { decodeSeo } from './seoDecoders';
import {
  isAuditDetailResponse,
  isAuditIssueTypesResponse,
  isAuditIssuesResponse,
  isAuditListResponse,
  isAuditResponse,
} from './seoAuditsDecoders';
import {
  seoGet, seoPost, type SeoRequestOptions
} from './seoRequest';
import type {
  AuditDetailResponse,
  AuditIssueTypesResponse,
  AuditIssuesResponse,
  AuditListResponse,
  AuditResponse,
  StartAuditRequest,
} from '../types/api/seoAudits';

const BASE = '/audits';

export async function listAudits(options: SeoRequestOptions = {}): Promise<AuditListResponse> {
  return decodeSeo(await seoGet(BASE, {}, options), isAuditListResponse, 'audit list');
}

export async function fetchAudit(auditId: string, options: SeoRequestOptions = {}): Promise<AuditDetailResponse> {
  return decodeSeo(await seoGet(`${BASE}/${encodeURIComponent(auditId)}`, {}, options), isAuditDetailResponse, 'audit');
}

export async function startAudit(request: StartAuditRequest, options: SeoRequestOptions = {}): Promise<AuditResponse> {
  return decodeSeo(await seoPost(BASE, request, options), isAuditResponse, 'started audit');
}

export async function cancelAudit(auditId: string, options: SeoRequestOptions = {}): Promise<AuditResponse> {
  const payload = await seoPost(`${BASE}/${encodeURIComponent(auditId)}/cancel`, {}, options);
  return decodeSeo(payload, isAuditResponse, 'cancelled audit');
}

export async function fetchIssueTypes(auditId: string, options: SeoRequestOptions = {}): Promise<AuditIssueTypesResponse> {
  const payload = await seoGet(`${BASE}/${encodeURIComponent(auditId)}/issues`, {}, options);
  return decodeSeo(payload, isAuditIssueTypesResponse, 'audit issue list');
}

/** One page of the URLs affected by `issueType`; pass the previous answer's `next_token` for the next page. */
export async function fetchIssuePages(
  auditId: string, issueType: string, nextToken: string | null, options: SeoRequestOptions = {}
): Promise<AuditIssuesResponse> {
  const payload = await seoGet(`${BASE}/${encodeURIComponent(auditId)}/issues`, {
    issue_type: issueType,
    next_token: nextToken ?? undefined,
  }, options);
  return decodeSeo(payload, isAuditIssuesResponse, 'affected pages');
}
