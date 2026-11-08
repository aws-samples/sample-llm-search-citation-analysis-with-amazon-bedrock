/**
 * Types of the SEO Backlinks API (`${SEO_API_BASE_URL}/seo/backlinks/...`,
 * `lambda/seo/seo-backlinks.py`), field for field. Every metric is nullable:
 * DataForSEO omits fields freely, and an unknown value is not zero.
 */
import type {
  SeoExportAnswer, SeoExportWindow
} from './seo';

export type BacklinksScope = 'exact_url' | 'subfolder' | 'domain' | 'subdomains';
export type BacklinksTab = 'backlinks' | 'referring_domains' | 'top_pages';
export type BacklinksMode = 'one_per_domain' | 'as_is';
export type SortOrder = 'asc' | 'desc';

export interface BacklinksSummary {
  readonly rank: number | null;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
  readonly referring_pages: number | null;
  readonly broken_backlinks: number | null;
  readonly broken_pages: number | null;
  readonly backlinks_spam_score: number | null;
  readonly target_spam_score: number | null;
  readonly new_backlinks: number | null;
  readonly lost_backlinks: number | null;
  readonly new_referring_domains: number | null;
  readonly lost_referring_domains: number | null;
}

export interface BacklinksTrendPoint {
  readonly date: string;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
  readonly rank: number | null;
}

export interface BacklinksNewLostPoint
  extends Pick<BacklinksSummary, 'new_backlinks' | 'lost_backlinks' | 'new_referring_domains' | 'lost_referring_domains'> {readonly date: string;}

export interface BacklinksTargetRequest {
  readonly target: string;
  readonly scope?: BacklinksScope;
}

/** The resolved target every backlinks answer echoes. */
export interface BacklinksTargetEcho {
  /** What to show: the hostname, `hostname/path` for a subfolder, the page URL for an exact page. */
  readonly target: string;
  readonly api_target: string;
  readonly scope: BacklinksScope;
}

export interface BacklinksOverviewResponse extends BacklinksTargetEcho {
  /** `null` when DataForSEO has no data; a subfolder has only `backlinks` and `referring_domains`. */
  readonly summary: Partial<BacklinksSummary> | null;
  readonly trends: readonly BacklinksTrendPoint[];
  readonly new_lost_trends: readonly BacklinksNewLostPoint[];
  readonly history_available: boolean;
  readonly history_includes_subdomains: boolean;
  readonly history_failed: boolean;
  /** The history call was not sent: the caller's daily limit of paid DataForSEO calls was reached (2.47.0). */
  readonly history_limit_reached?: boolean;
  readonly cached: boolean;
  readonly fetched_at: string;
}

export interface BacklinkRow {
  readonly domain_from: string | null;
  readonly url_from: string | null;
  readonly url_to: string | null;
  readonly anchor: string | null;
  readonly item_type: string | null;
  readonly dofollow: boolean | null;
  readonly rel_attributes: readonly string[];
  readonly rank: number | null;
  readonly domain_from_rank: number | null;
  readonly page_from_rank: number | null;
  readonly spam_score: number | null;
  readonly first_seen: string | null;
  readonly last_seen: string | null;
  readonly is_lost: boolean;
  readonly is_broken: boolean;
  readonly links_count: number | null;
}

export interface ReferringDomainRow {
  readonly domain: string | null;
  readonly backlinks: number | null;
  readonly referring_pages: number | null;
  readonly rank: number | null;
  readonly spam_score: number | null;
  readonly first_seen: string | null;
  readonly broken_backlinks: number | null;
  readonly broken_pages: number | null;
}

export interface TopPageRow {
  readonly page: string | null;
  readonly backlinks: number | null;
  readonly referring_domains: number | null;
  readonly rank: number | null;
  readonly broken_backlinks: number | null;
}

export interface BacklinksTableRows {
  readonly backlinks: BacklinkRow;
  readonly referring_domains: ReferringDomainRow;
  readonly top_pages: TopPageRow;
}

/** The filter fields of each table; unset fields are left out. */
export interface BacklinksFilters {
  readonly include?: string;
  readonly exclude?: string;
  readonly min_domain_rank?: number;
  readonly max_domain_rank?: number;
  readonly min_link_rank?: number;
  readonly max_link_rank?: number;
  readonly min_spam_score?: number;
  readonly max_spam_score?: number;
  readonly min_backlinks?: number;
  readonly max_backlinks?: number;
  readonly min_rank?: number;
  readonly max_rank?: number;
  readonly min_referring_domains?: number;
  readonly max_referring_domains?: number;
  readonly link_type?: 'all' | 'dofollow' | 'nofollow';
  readonly hide_lost?: boolean;
  readonly hide_broken?: boolean;
  readonly domain_from?: string;
}

/** A page (`page`, `page_size`) or, with `limit`, an export chunk of `limit` rows from `offset`. */
export interface BacklinksTableRequest extends BacklinksTargetRequest, SeoExportWindow {
  readonly page?: number;
  readonly page_size?: 50 | 100 | 200;
  readonly sort_field?: string;
  readonly sort_order: SortOrder;
  readonly filters: BacklinksFilters;
  readonly include_spam: boolean;
  /** Backlinks only. */
  readonly mode?: BacklinksMode;
}

export interface BacklinksTableResponse<TTab extends BacklinksTab> extends BacklinksTargetEcho, SeoExportAnswer {
  readonly tab: TTab;
  readonly rows: ReadonlyArray<BacklinksTableRows[TTab]>;
  readonly total_count: number | null;
  readonly has_more: boolean;
  readonly page: number;
  readonly page_size: number;
  readonly conditions_used: number;
  readonly condition_limit: number;
  readonly cached: boolean;
  readonly fetched_at: string;
}

export interface BacklinkSnapshotPoint extends BacklinksSummary {readonly snapshot_at: string;}

export interface TrackedBacklinkDomain {
  readonly domain: string;
  readonly role: 'owned' | 'competitor';
  readonly competitor: string | null;
  /** Oldest first. */
  readonly snapshots: readonly BacklinkSnapshotPoint[];
}

export interface BacklinkSnapshotsResponse {readonly domains: readonly TrackedBacklinkDomain[];}

export interface BacklinkSnapshotRunResponse {
  readonly started: boolean;
  readonly domains: number;
}

