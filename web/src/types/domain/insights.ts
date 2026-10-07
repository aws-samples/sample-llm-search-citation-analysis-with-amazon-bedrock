/**
 * `GET /reports/insights`: the facts a scope's latest runs and group history
 * establish, and the insights drawn from them, as `lambda/shared/insights_engine.py`
 * computes them. Every number shown comes from this payload; the dashboard
 * recomputes none.
 */
import type { ReportScopeInfo } from './baseTypes';
import type { BrandKpis } from './groupKpiHistory';

/**
 * What to do about one AI engine, from the brand's top-1 share and citation
 * rate over its answers: earn its citations, earn the first place, both, or
 * keep a position that already has both.
 */
export type EnginePlay = 'get_cited' | 'get_ranked_first' | 'get_mentioned_and_cited' | 'defend';

/** One AI engine that answered in the scope's latest runs, with its play. */
export interface EnginePlayRow {
  engine: string;
  play: EnginePlay;
  /** Every KPI of the tracked brand over that engine's answers (`engine_breakdown`). */
  kpis: BrandKpis;
}

/** A first-party brand named in at least three answers, measured against the best of them. */
export interface PortfolioBrandRow {
  name: string;
  mentions: number;
  average_position: number | null;
  net_sentiment: number | null;
  /** Answers citing the brand's own domains; `null` while the brand table attributes none. */
  citations: number | null;
  /** Places behind the best (lowest) qualifying average position; `null` when either is unknown. */
  position_gap: number | null;
  /** Points behind the best qualifying net sentiment; `null` when either is unknown. */
  sentiment_gap: number | null;
  /** A gap at or over its threshold (2 places, 30 points). */
  weak: boolean;
}

/** One keyword of a group over the runs in the window that placed the brand. */
export interface KeywordStabilityRow {
  keyword: string;
  runs: number;
  position_min: number;
  position_max: number;
  /** `position_max - position_min`; 0 for a single run. */
  position_range: number;
  /** Runs in which the brand's mention was gained or lost since the keyword's previous run. */
  flips: number;
  /** Two runs or more, and a range of 3 places or more or at least one flip. */
  unstable: boolean;
}

export interface InsightFacts {
  /** One row per engine that answered, in engine order. */
  engines: EnginePlayRow[];
  /** Empty unless two first-party brands qualify. */
  portfolio: PortfolioBrandRow[];
  /** Group scope only; empty for every other scope. */
  stability: KeywordStabilityRow[];
}

export type InsightKind = 'engine_play' | 'weak_subbrand' | 'unstable_keyword';

export type InsightSeverity = 'high' | 'medium' | 'low';

/** The custom-report block that shows the detail behind an insight. */
export type InsightBlock = 'insights_engine_playbook' | 'insights_brand_portfolio' | 'insights_run_stability';

/** Every number an insight rests on, by its name in `facts`; the engine play rides along as a string. */
export type InsightEvidence = Readonly<Record<string, number | string | null>>;

export interface Insight {
  /** `kind:subject`. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** The engine, brand or keyword the insight is about. */
  subject: string;
  evidence: InsightEvidence;
  block: InsightBlock;
}

export interface ReportInsightsResponse {
  scope: ReportScopeInfo;
  keywords_truncated: boolean;
  /** The newest run among the keywords. */
  timestamp: string | null;
  keywords_analyzed: number;
  keywords_with_data: number;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  citations_configured: boolean;
  facts: InsightFacts;
  /** By severity (high, medium, low), then by the answers or mentions behind each. */
  insights: Insight[];
  /** Always `null` in Phase 1; an object once a narrative is generated. */
  narrative: Record<string, unknown> | null;
}
