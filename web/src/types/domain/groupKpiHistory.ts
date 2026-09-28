/**
 * `GET /reports/group-kpis`: every analysis run of a keyword group (one
 * hotel) with its citation rate, share of voice and prominence, the keywords
 * that drove each change, and a per-keyword drill-down of every run.
 * Formulas and run semantics: `lambda/shared/group_kpi_history.py`.
 */
import type { ReportScopeInfo } from './baseTypes';
import { isRecord } from './keywordDecoders';

/** The group values of one run (the same fields as the `/visibility` group summary). */
export interface GroupRunSummary {
  /** Citation rate: % of keywords with data whose answers mention the hotel. */
  coverage_rate: number;
  /** Share of voice: mean over keywords of first-party mentions / all brand mentions. */
  first_party_avg_sov: number;
  rank_1_share: number;
  top_3_share: number;
  mean_rank: number | null;
  mean_first_position: number | null;
  first_party_avg_score: number;
  competitor_avg_score: number;
  competitor_avg_sov: number;
  provider_coverage: number;
  first_party_mean_best_rank: number | null;
}

/** The group KPIs compared between consecutive group runs. */
export type GroupKpiField = 'coverage_rate' | 'first_party_avg_sov' | 'rank_1_share' | 'top_3_share' | 'mean_rank';

export type MentionChange = 'gained' | 'lost' | null;

/** How one keyword moved between two runs (points; `null` when either side is unknown). */
export interface KeywordChanges {
  mention: MentionChange;
  first_party_sov: number | null;
  rank_1_share: number | null;
  top_3_share: number | null;
  mean_rank: number | null;
}

/** A keyword that moved between two group runs, and its share of the group's move. */
export interface GroupRunDriver {
  keyword: string;
  changes: KeywordChanges;
  impact: {
    coverage_rate: number;
    first_party_avg_sov: number;
  };
}

export interface GroupRunChange {
  previous_timestamp: string;
  deltas: Record<GroupKpiField, number | null>;
  drivers: GroupRunDriver[];
  keywords_entered: string[];
  keywords_left: string[];
}

export interface GroupRun {
  timestamp: string;
  keywords_with_data: number;
  keywords_total: number;
  /** % of the group's keywords with data in this run. */
  coverage: number;
  /** Covers at least `group_run_min_coverage` % of the keywords; only these are compared. */
  is_group_run: boolean;
  summary: GroupRunSummary;
  /** Provider -> the models that answered in this run. */
  models: Record<string, string[]>;
  change: GroupRunChange | null;
}

export interface KeywordRun {
  timestamp: string;
  first_party_mentioned: boolean;
  first_party_sov: number;
  rank_1_share: number;
  top_3_share: number;
  mean_rank: number | null;
  first_party_best_rank: number | null;
  answers: number;
  mentioned_answers: number;
  first_party_score: number;
  change: (KeywordChanges & { previous_timestamp: string }) | null;
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
  runs: GroupRun[];
  keywords: KeywordRunHistory[];
}

function isGroupRun(value: unknown): value is GroupRun {
  return isRecord(value)
    && typeof value.timestamp === 'string'
    && typeof value.is_group_run === 'boolean'
    && isRecord(value.summary)
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
