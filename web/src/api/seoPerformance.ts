/**
 * Page performance client: the `/seo/lighthouse/...` and `/seo/indexnow/...` routes of the SEO API
 * (`lambda/seo/seo-performance.py`).
 *
 * Starting a Lighthouse run is paid and happens only on an explicit user action; nothing here retries it
 * (a timed-out start may already have bought a report). Reading runs, the batch sample, an audit's pages
 * (`/seo/audits/{id}/pages`) and the IndexNow setup is free. IndexNow itself is free; its writes are Admin only
 * on the server.
 */
import {
  seoGet, seoPost, type SeoRequestOptions
} from './seoRequest';
import { decodeSeo } from './seoDecoders';
import {
  isAuditPagesResponse,
  isCreateKeyResponse,
  isIndexNowSetup,
  isKeyFileCheck,
  isLighthouseSample,
  isRunResponse,
  isRunsResponse,
  isStartRunResponse,
  isSubmitResponse,
} from './seoPerformanceDecoders';
import type {
  CreateKeyResponse,
  IndexNowSetup,
  KeyFileCheck,
  LighthouseDevice,
  LighthouseRun,
  LighthouseRunHeader,
  LighthouseSample,
  StartRunResponse,
  SubmitRequest,
  SubmitResponse,
} from '../types/api/seoPerformance';

/** Paid: measures one owned page on one device (about $0.005); answers the run to poll. */
export async function startLighthouse(
  request: {
    url: string;
    device: LighthouseDevice 
  }, options: SeoRequestOptions = {}
): Promise<StartRunResponse> {
  return decodeSeo(await seoPost('/lighthouse', request, options), isStartRunResponse, 'Lighthouse run');
}

/** Paid, Admin: measures the audit's sample pages on mobile and desktop. */
export async function startLighthouseBatch(auditId: string, options: SeoRequestOptions = {}): Promise<StartRunResponse> {
  return decodeSeo(await seoPost('/lighthouse/batch', { audit_id: auditId }, options), isStartRunResponse, 'Lighthouse run');
}

export async function fetchLighthouseRun(runId: string, options: SeoRequestOptions = {}): Promise<LighthouseRun> {
  const answer = decodeSeo(
    await seoGet(`/lighthouse/${encodeURIComponent(runId)}`, {}, options), isRunResponse, 'Lighthouse run'
  );
  return answer.run;
}

export async function fetchLighthouseRuns(options: SeoRequestOptions = {}): Promise<LighthouseRunHeader[]> {
  return decodeSeo(await seoGet('/lighthouse', {}, options), isRunsResponse, 'Lighthouse run list').runs;
}

export async function fetchLighthouseSample(options: SeoRequestOptions = {}): Promise<LighthouseSample> {
  return decodeSeo(await seoGet('/lighthouse/sample', {}, options), isLighthouseSample, 'Lighthouse sample');
}

/** Free: the URLs of the first `limit` pages the audit crawled (the site audit's own pages route). */
export async function fetchAuditPageUrls(auditId: string, limit: number, options: SeoRequestOptions = {}): Promise<string[]> {
  const payload = await seoGet(`/audits/${encodeURIComponent(auditId)}/pages`, { limit: String(limit) }, options);
  return decodeSeo(payload, isAuditPagesResponse, 'audit pages').pages.map((page) => page.url);
}

export async function fetchIndexNowSetup(options: SeoRequestOptions = {}): Promise<IndexNowSetup> {
  return decodeSeo(await seoGet('/indexnow', {}, options), isIndexNowSetup, 'IndexNow setup');
}

export async function createIndexNowKey(domain: string, options: SeoRequestOptions = {}): Promise<CreateKeyResponse> {
  return decodeSeo(await seoPost('/indexnow/key', { domain }, options), isCreateKeyResponse, 'IndexNow key');
}

export async function checkIndexNowKeyFile(domain: string, options: SeoRequestOptions = {}): Promise<KeyFileCheck> {
  return decodeSeo(await seoPost('/indexnow/check', { domain }, options), isKeyFileCheck, 'key file check');
}

export async function submitIndexNow(request: SubmitRequest, options: SeoRequestOptions = {}): Promise<SubmitResponse> {
  return decodeSeo(await seoPost('/indexnow/submit', request, options), isSubmitResponse, 'IndexNow submission');
}
