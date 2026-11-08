/**
 * Rank tracking API payloads for the specs of `./seoRankTracking`, its decoders and the Rank Tracking view.
 * Fictional domains only.
 */
import type {
  RankCell,
  RankEstimate,
  RankResultRow,
  RankResults,
  RankRun,
  RankTracker,
  RankTrackerList,
  RankTrend,
  RankTrendPoint,
} from '../types/api/seoRankTracking';

export function buildRankRun(overrides: Partial<RankRun> = {}): RankRun {
  return {
    run_id: '20261005T080000Z-0a1b2c3d',
    status: 'completed',
    trigger: 'manual',
    method: 'live',
    is_subset: false,
    devices: ['desktop', 'mobile'],
    keywords_total: 2,
    keywords_checked: 2,
    checked: {
      desktop: 2,
      mobile: 2,
    },
    error_code: null,
    error_message: null,
    started_at: '2026-10-05T08:00:00.000000Z',
    completed_at: '2026-10-05T08:01:00.000000Z',
    ...overrides,
  };
}

export function buildRankTracker(overrides: Partial<RankTracker> = {}): RankTracker {
  return {
    tracker_id: 'rt-example',
    domain: 'example.com',
    market_id: 'global',
    devices: 'both',
    depth: 30,
    schedule: 'weekly',
    keyword_scope: 'all',
    group_id: null,
    keyword_count: 2,
    scope_keyword_count: 2,
    extra_keyword_count: 0,
    max_keywords: 1000,
    is_active: true,
    next_check_at: '2026-10-12T06:00:00.000000Z',
    last_checked_at: '2026-10-05T08:01:00.000000Z',
    last_skip_reason: null,
    created_at: '2026-09-01T08:00:00.000000Z',
    updated_at: '2026-09-01T08:00:00.000000Z',
    latest_run: buildRankRun(),
    ...overrides,
  };
}

export function buildTrackerList(overrides: Partial<RankTrackerList> = {}): RankTrackerList {
  return {
    trackers: [buildRankTracker()],
    owned_domains: ['example.com'],
    competitor_domains: { Acme: ['acme.example.org'] },
    ...overrides,
  };
}

export function buildRankCell(overrides: Partial<RankCell> = {}): RankCell {
  return {
    status: 'found',
    position: 4,
    previous_position: 6,
    rank_absolute: 5,
    url: 'https://example.com/flights',
    serp_features: ['organic', 'people_also_ask'],
    checked_at: '2026-10-05T08:00:30.000000Z',
    ...overrides,
  };
}

export function buildResultRow(overrides: Partial<RankResultRow> = {}): RankResultRow {
  return {
    keyword_id: 'kw-1',
    keyword: 'cheap flights',
    source: 'list',
    desktop: buildRankCell(),
    mobile: buildRankCell({
      position: 7,
      previous_position: 7,
    }),
    ...overrides,
  };
}

export function buildRankResults(overrides: Partial<RankResults> = {}): RankResults {
  return {
    tracker_id: 'rt-example',
    period: '7d',
    devices: ['desktop', 'mobile'],
    baseline_run_id: '20260928T080000Z-00000000',
    baseline_started_at: '2026-09-28T08:00:00.000000Z',
    rows: [buildResultRow()],
    ...overrides,
  };
}

export function buildTrendPoint(overrides: Partial<RankTrendPoint> = {}): RankTrendPoint {
  return {
    run_id: '20261005T080000Z-0a1b2c3d',
    started_at: '2026-10-05T08:00:00.000000Z',
    device: 'desktop',
    total: 2,
    top3: 0,
    top4_10: 1,
    top11_20: 1,
    not_ranking: 0,
    not_checked: 0,
    ...overrides,
  };
}

export function buildRankTrend(points: RankTrendPoint[] = [buildTrendPoint()]): RankTrend {
  return {
    tracker_id: 'rt-example',
    days: 90,
    points,
  };
}

export function buildRankEstimate(overrides: Partial<RankEstimate> = {}): RankEstimate {
  return {
    keyword_count: 2,
    scope_keyword_count: 2,
    max_keywords: 1000,
    pairs: 4,
    checks_per_month: 4,
    ...overrides,
  };
}
