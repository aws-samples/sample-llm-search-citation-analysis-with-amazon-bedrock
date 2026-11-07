/**
 * SEO Backlinks API client (`${SEO_API_BASE_URL}/seo/backlinks/...`).
 *
 * The overview and the three tables are paid DataForSEO lookups: they are
 * sent only when the user asks (Search, a tab, a page, a sort, an expanded
 * domain) and never retried, since a timed-out call may already be billed.
 * The snapshot list is a free read. Starting a snapshot run and the weekly
 * schedule are Admin only. Every answer passes the guards of
 * `./seoBacklinksDecoders`.
 */
import { decodeSeo } from './seoDecoders';
import {
  isBacklinkScheduleResponse,
  isBacklinkSnapshotRunResponse,
  isBacklinkSnapshotsResponse,
  isBacklinksOverviewResponse,
  isBacklinksTableResponse,
} from './seoBacklinksDecoders';
import {
  seoGet, seoPost, seoSend, type SeoRequestOptions
} from './seoRequest';
import type {
  BacklinkScheduleResponse,
  BacklinkSnapshotRunResponse,
  BacklinkSnapshotsResponse,
  BacklinksOverviewResponse,
  BacklinksTab,
  BacklinksTableRequest,
  BacklinksTableResponse,
  BacklinksTargetRequest,
} from '../types/api/seoBacklinks';

const TABLE_PATHS: Record<BacklinksTab, string> = {
  backlinks: '/backlinks/rows',
  referring_domains: '/backlinks/referring-domains',
  top_pages: '/backlinks/top-pages',
};

export async function fetchBacklinksOverview(
  request: BacklinksTargetRequest, options: SeoRequestOptions = {}
): Promise<BacklinksOverviewResponse> {
  const payload = await seoPost('/backlinks/overview', request, options);
  return decodeSeo(payload, isBacklinksOverviewResponse, 'backlinks overview');
}

export async function fetchBacklinksTable<TTab extends BacklinksTab>(
  tab: TTab, request: BacklinksTableRequest, options: SeoRequestOptions = {}
): Promise<BacklinksTableResponse<TTab>> {
  const payload = await seoPost(TABLE_PATHS[tab], request, options);
  return decodeSeo(payload, isBacklinksTableResponse(tab), 'backlinks table');
}

export async function fetchBacklinkSnapshots(options: SeoRequestOptions = {}): Promise<BacklinkSnapshotsResponse> {
  const payload = await seoGet('/backlinks/snapshots', {}, options);
  return decodeSeo(payload, isBacklinkSnapshotsResponse, 'backlink snapshots');
}

export async function startBacklinkSnapshots(): Promise<BacklinkSnapshotRunResponse> {
  const payload = await seoPost('/backlinks/snapshots', {});
  return decodeSeo(payload, isBacklinkSnapshotRunResponse, 'snapshot run');
}

export async function setBacklinkSnapshotSchedule(enabled: boolean): Promise<BacklinkScheduleResponse> {
  const payload = await seoSend('PUT', '/backlinks/snapshots/schedule', { enabled });
  return decodeSeo(payload, isBacklinkScheduleResponse, 'snapshot schedule');
}
