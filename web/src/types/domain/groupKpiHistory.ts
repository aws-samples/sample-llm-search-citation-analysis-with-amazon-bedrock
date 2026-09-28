/**
 * `GET /reports/group-kpis`: every analysis run of a keyword group with its
 * KPIs, the keywords that drove each change, and a per-keyword drill-down of
 * every run. KPIs: `docs/kpi-definitions.md`; run semantics:
 * `lambda/shared/group_kpi_history.py`.
 */
import type { ReportScopeInfo } from './baseTypes';
import type { KpiId } from '../../constants/kpiDefinitions';
import { isRecord } from './keywordDecoders';

/** The KPIs a trend is called for: every rate and score, not the counts (`TRENDED_KPIS`). */
export type TrendedKpiId = Exclude<KpiId, 'answers' | 'mentions' | 'citations'>;

export type KpiTrend = 'improving' | 'declining' | 'stable';

export interface SentimentSplit {
  positive: number;
  neutral: number;
  negative: number;
  mixed: number;
}

/**
 * Every KPI of the tracked brand over a set of answers (`brand_kpis`). Rates
 * are `null` when there is nothing to divide by; the citation KPIs are
 * `null` until owned domains are configured.
 */
export type BrandKpis = Record<KpiId, number | null> & {
  /** AI engines with at least one answer. */
  engines: number;
  /** Keywords with at least one answer. */
  keywords: number;
  sentiment_split: SentimentSplit;
};

/** `current - previous` of every KPI (points, positions or counts); `null` when either side is unknown. */
export type KpiDeltas = Record<KpiId, number | null>;

export type MentionChange = 'gained' | 'lost' | null;

/** A keyword that moved between two group runs, and its share of the group's move. */
export interface GroupRunDriver {
  keyword: string;
  mention: MentionChange;
  deltas: KpiDeltas;
  /** The keyword's change weighted by its share of the run's answers, in points. */
  impact: {
    mention_rate: number;
    visibility_score: number;
  };
}

export interface GroupRunChange {
  previous_timestamp: string;
  deltas: KpiDeltas;
  trends: Record<TrendedKpiId, KpiTrend>;
  drivers: GroupRunDriver[];
  keywords_entered: string[];
  keywords_left: string[];
}

export interface GroupRun {
  timestamp: string;
  keywords_with_data: number;
  keywords_total: number;
  /** % of the group's keywords answered in this run. */
  coverage: number;
  /** Answers at least `group_run_min_coverage` % of the keywords; only these are compared. */
  is_group_run: boolean;
  kpis: BrandKpis;
  /** Engine -> the models that answered in this run. */
  models: Record<string, string[]>;
  change: GroupRunChange | null;
}

export interface KeywordRun {
  timestamp: string;
  kpis: BrandKpis;
  change: {
    previous_timestamp: string;
    mention: MentionChange;
    deltas: KpiDeltas;
  } | null;
}

export interface KeywordRunHistory {
  keyword: string;
  runs: KeywordRun[];
}

export interface GroupKpiHistoryResponse {
  scope: ReportScopeInfo;
  days: number;
  group_run_min_coverage: number;
  keywords_truncated: boolean;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  citations_configured: boolean;
  runs: GroupRun[];
  keywords: KeywordRunHistory[];
}

function isGroupRun(value: unknown): value is GroupRun {
  return isRecord(value)
    && typeof value.timestamp === 'string'
    && typeof value.is_group_run === 'boolean'
    && isRecord(value.kpis)
    && isRecord(value.models);
}

function isKeywordRunHistory(value: unknown): value is KeywordRunHistory {
  return isRecord(value) && typeof value.keyword === 'string' && Array.isArray(value.runs);
}

export function isGroupKpiHistoryResponse(value: unknown): value is GroupKpiHistoryResponse {
  return isRecord(value)
    && isRecord(value.scope)
    && Array.isArray(value.runs)
    && value.runs.every(isGroupRun)
    && Array.isArray(value.keywords)
    && value.keywords.every(isKeywordRunHistory);
}
