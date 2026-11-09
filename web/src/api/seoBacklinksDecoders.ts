/**
 * Runtime guards for the SEO Backlinks API (`./seoBacklinks`), mirroring
 * `web/src/types/api/seoBacklinks.ts`. Each shape is a field → kind table, so
 * a guard reads as the type it checks.
 */
import { isFiniteNumber } from './contentStudioDecoderPrimitives';
import { isRecord } from '../types/domain/keywordDecoders';
import { isExportAnswer } from './seoDecoders';
import type {
  BacklinkSnapshotRunResponse,
  BacklinkSnapshotsResponse,
  BacklinksOverviewResponse,
  BacklinksTab,
  BacklinksTableResponse,
} from '../types/api/seoBacklinks';

type FieldKind = 'number' | 'number?' | 'string' | 'string?' | 'boolean' | 'boolean?' | 'strings';
type Shape = Readonly<Record<string, FieldKind>>;

const CHECKS: Record<FieldKind, (value: unknown) => boolean> = {
  number: isFiniteNumber,
  'number?': (value) => value === null || isFiniteNumber(value),
  string: (value) => typeof value === 'string',
  'string?': (value) => value === null || typeof value === 'string',
  boolean: (value) => typeof value === 'boolean',
  'boolean?': (value) => value === null || typeof value === 'boolean',
  strings: (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
};

function matches(value: unknown, shape: Shape): value is Record<string, unknown> {
  return isRecord(value) && Object.entries(shape).every(([field, kind]) => CHECKS[kind](value[field]));
}

function listOf(value: unknown, shape: Shape): boolean {
  return Array.isArray(value) && value.every((item) => matches(item, shape));
}

const SCOPES = new Set(['exact_url', 'subfolder', 'domain', 'subdomains']);

const SUMMARY: Shape = {
  rank: 'number?',
  backlinks: 'number?',
  referring_domains: 'number?',
  referring_pages: 'number?',
  broken_backlinks: 'number?',
  broken_pages: 'number?',
  backlinks_spam_score: 'number?',
  target_spam_score: 'number?',
  new_backlinks: 'number?',
  lost_backlinks: 'number?',
  new_referring_domains: 'number?',
  lost_referring_domains: 'number?',
};

const TREND: Shape = {
  date: 'string',
  backlinks: 'number?',
  referring_domains: 'number?',
  rank: 'number?',
};

const NEW_LOST: Shape = {
  date: 'string',
  new_backlinks: 'number?',
  lost_backlinks: 'number?',
  new_referring_domains: 'number?',
  lost_referring_domains: 'number?',
};

const ROW_SHAPES: Record<BacklinksTab, Shape> = {
  backlinks: {
    domain_from: 'string?',
    url_from: 'string?',
    url_to: 'string?',
    anchor: 'string?',
    item_type: 'string?',
    dofollow: 'boolean?',
    rel_attributes: 'strings',
    rank: 'number?',
    domain_from_rank: 'number?',
    page_from_rank: 'number?',
    spam_score: 'number?',
    first_seen: 'string?',
    last_seen: 'string?',
    is_lost: 'boolean',
    is_broken: 'boolean',
    links_count: 'number?',
  },
  referring_domains: {
    domain: 'string?',
    backlinks: 'number?',
    referring_pages: 'number?',
    rank: 'number?',
    spam_score: 'number?',
    first_seen: 'string?',
    broken_backlinks: 'number?',
    broken_pages: 'number?',
  },
  top_pages: {
    page: 'string?',
    backlinks: 'number?',
    referring_domains: 'number?',
    rank: 'number?',
    broken_backlinks: 'number?',
  },
};

const ANSWER: Shape = {
  target: 'string',
  api_target: 'string',
  cached: 'boolean',
  fetched_at: 'string',
};

/** Present summary fields are numbers or null; a subfolder sends only two of them. */
function isPartialSummary(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value) && Object.entries(SUMMARY).every(([field, kind]) => !(field in value) || CHECKS[kind](value[field]));
}

function isScoped(value: Record<string, unknown>): boolean {
  return typeof value.scope === 'string' && SCOPES.has(value.scope);
}

export function isBacklinksOverviewResponse(value: unknown): value is BacklinksOverviewResponse {
  return matches(value, {
    ...ANSWER,
    history_available: 'boolean',
    history_includes_subdomains: 'boolean',
    history_failed: 'boolean',
  })
    && isScoped(value)
    && isPartialSummary(value.summary)
    && listOf(value.trends, TREND)
    && listOf(value.new_lost_trends, NEW_LOST);
}

/** The guard of one table's page. */
export function isBacklinksTableResponse<TTab extends BacklinksTab>(tab: TTab) {
  return (value: unknown): value is BacklinksTableResponse<TTab> => matches(value, {
    ...ANSWER,
    total_count: 'number?',
    has_more: 'boolean',
    page: 'number',
    page_size: 'number',
    conditions_used: 'number',
    condition_limit: 'number',
  })
    && isScoped(value)
    && isExportAnswer(value)
    && value.tab === tab
    && listOf(value.rows, ROW_SHAPES[tab]);
}

const TRACKED_ROLES = new Set(['owned', 'competitor']);

function isTrackedDomain(value: unknown): boolean {
  return matches(value, {
    domain: 'string',
    competitor: 'string?',
  })
    && typeof value.role === 'string' && TRACKED_ROLES.has(value.role)
    && listOf(value.snapshots, {
      ...SUMMARY,
      snapshot_at: 'string',
    });
}

export function isBacklinkSnapshotsResponse(value: unknown): value is BacklinkSnapshotsResponse {
  return isRecord(value)
    && typeof value.estimated_run_cost_usd === 'number'
    && Array.isArray(value.domains) && value.domains.every(isTrackedDomain);
}

export function isBacklinkSnapshotRunResponse(value: unknown): value is BacklinkSnapshotRunResponse {
  return matches(value, {
    started: 'boolean',
    domains: 'number',
  });
}
