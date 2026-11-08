/**
 * Backlinks API payloads for the specs of `./seoBacklinks`, its decoders and
 * the Backlinks page (fictional domains only).
 */
import type {
  BacklinkRow,
  BacklinkSnapshotPoint,
  BacklinkSnapshotsResponse,
  BacklinksOverviewResponse,
  BacklinksSummary,
  BacklinksTab,
  BacklinksTableResponse,
  BacklinksTableRows,
  ReferringDomainRow,
  TopPageRow,
  TrackedBacklinkDomain,
} from '../types/api/seoBacklinks';
import type { SeoExportPricing } from '../types/api/seo';

/** The `export` block of a backlinks table answer: `backlinks_usd` = 0.024 a request + 0.000036 a row. */
export const BACKLINKS_EXPORT: SeoExportPricing = {
  max_rows: 10_000,
  rows_per_request: 1000,
  request_usd: 0.024,
  row_usd: 0.000036,
  cache_hours: 6,
};

export function buildSummary(overrides: Partial<BacklinksSummary> = {}): BacklinksSummary {
  return {
    rank: 41,
    backlinks: 12400,
    referring_domains: 380,
    referring_pages: 9100,
    broken_backlinks: 25,
    broken_pages: 4,
    backlinks_spam_score: 7,
    target_spam_score: 3,
    new_backlinks: 120,
    lost_backlinks: 80,
    new_referring_domains: 12,
    lost_referring_domains: 5,
    ...overrides,
  };
}

export function buildOverview(overrides: Partial<BacklinksOverviewResponse> = {}): BacklinksOverviewResponse {
  return {
    target: 'example.com',
    api_target: 'example.com',
    scope: 'subdomains',
    summary: buildSummary(),
    trends: [
      {
        date: '2026-08-01',
        backlinks: 11500,
        referring_domains: 360,
        rank: 39,
      },
      {
        date: '2026-09-01',
        backlinks: 12000,
        referring_domains: 370,
        rank: 40,
      },
    ],
    new_lost_trends: [{
      date: '2026-09-01',
      new_backlinks: 100,
      lost_backlinks: 70,
      new_referring_domains: 10,
      lost_referring_domains: 4,
    }],
    history_available: true,
    history_includes_subdomains: true,
    history_failed: false,
    cached: false,
    fetched_at: '2026-10-02T08:00:00.000000Z',
    ...overrides,
  };
}

export function buildBacklinkRow(overrides: Partial<BacklinkRow> = {}): BacklinkRow {
  return {
    domain_from: 'blog.example.org',
    url_from: 'https://blog.example.org/review',
    url_to: 'https://example.com/pricing',
    anchor: 'Example pricing',
    item_type: 'anchor',
    dofollow: true,
    rel_attributes: [],
    rank: 22,
    domain_from_rank: 55,
    page_from_rank: 18,
    spam_score: 0,
    first_seen: '2026-08-01 10:00:00 +00:00',
    last_seen: '2026-09-30 10:00:00 +00:00',
    is_lost: false,
    is_broken: false,
    links_count: 1,
    ...overrides,
  };
}

export function buildReferringDomainRow(overrides: Partial<ReferringDomainRow> = {}): ReferringDomainRow {
  return {
    domain: 'blog.example.org',
    backlinks: 14,
    referring_pages: 9,
    rank: 55,
    spam_score: 12,
    first_seen: '2025-02-01 00:00:00 +00:00',
    broken_backlinks: 1,
    broken_pages: 0,
    ...overrides,
  };
}

export function buildTopPageRow(overrides: Partial<TopPageRow> = {}): TopPageRow {
  return {
    page: 'https://example.com/pricing',
    backlinks: 300,
    referring_domains: 41,
    rank: 30,
    broken_backlinks: 2,
    ...overrides,
  };
}

export function buildTablePage<TTab extends BacklinksTab>(
  tab: TTab,
  rows: ReadonlyArray<BacklinksTableRows[TTab]>,
  overrides: Partial<BacklinksTableResponse<TTab>> = {},
): BacklinksTableResponse<TTab> {
  return {
    target: 'example.com',
    api_target: 'example.com',
    scope: 'subdomains',
    tab,
    rows,
    total_count: 120,
    has_more: true,
    page: 1,
    page_size: 50,
    conditions_used: 2,
    condition_limit: 6,
    offset: null,
    limit: null,
    export: BACKLINKS_EXPORT,
    cached: false,
    fetched_at: '2026-10-02T08:00:00.000000Z',
    ...overrides,
  };
}

export function buildSnapshotPoint(snapshotAt: string, rank: number): BacklinkSnapshotPoint {
  return {
    ...buildSummary({ rank }),
    snapshot_at: snapshotAt,
  };
}

export function buildTrackedDomain(overrides: Partial<TrackedBacklinkDomain> = {}): TrackedBacklinkDomain {
  return {
    domain: 'example.com',
    role: 'owned',
    competitor: null,
    snapshots: [buildSnapshotPoint('2026-09-28T06:00:00Z', 40), buildSnapshotPoint('2026-10-05T06:00:00Z', 41)],
    ...overrides,
  };
}

export function buildSnapshots(overrides: Partial<BacklinkSnapshotsResponse> = {}): BacklinkSnapshotsResponse {
  return {
    domains: [
      buildTrackedDomain(),
      buildTrackedDomain({
        domain: 'acme.example.org',
        role: 'competitor',
        competitor: 'Acme',
        snapshots: [buildSnapshotPoint('2026-10-05T06:00:00Z', 52)],
      }),
    ],
    ...overrides,
  };
}
