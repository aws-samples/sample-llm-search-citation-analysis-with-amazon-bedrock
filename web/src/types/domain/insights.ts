/**
 * `GET /reports/insights`: the facts a scope's latest runs and group history
 * establish, and the insights drawn from them, as `lambda/shared/insights_engine.py`
 * computes them. Every number shown comes from this payload; the dashboard
 * recomputes none.
 */
import type { ReportScopeInfo } from './baseTypes';
import type { BrandKpis } from './groupKpiHistory';
import type { InsightsNarrative } from './insightsNarrative';

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

/** One keyword of the latest runs: the brand's best position on each AI engine that answered it. */
export interface PromptEngineRow {
  keyword: string;
  /** The tracked brand's visibility score over the keyword's answers. */
  visibility_score: number | null;
  /** Per engine that answered: the best position, `null` when no answer names the brand at a known position. */
  positions: Readonly<Record<string, number | null>>;
  /** The engines placing the brand below 3rd or not at all. */
  lost_engines: string[];
}

export interface PromptEngineFacts {
  /** Every engine that answered, in engine order. */
  engines: string[];
  /** Lowest visibility score first, at most 50. */
  keywords: PromptEngineRow[];
  /** Keywords left out beyond the 50. */
  omitted: number;
}

/** One AI engine's (answer, URL) citations split by whose site they point at. */
export interface CitationOwnershipRow {
  engine: string;
  answers: number;
  /** `owned + every competitor + third_party`. */
  citations: number;
  owned: number;
  /** Per tracked competitor with configured domains. */
  competitors: Readonly<Record<string, number>>;
  third_party: number;
}

export interface CitationOwnershipFacts {
  /** Whether owned domains are configured; without them `owned` is always 0. */
  owned_configured: boolean;
  /** Whether competitor domains are configured; without them every other citation is third party. */
  competitors_configured: boolean;
  engines: CitationOwnershipRow[];
}

/** One owned page: host and path, without scheme or query. */
export interface OwnedPageRow {
  url: string;
  /** Host and first path segment. */
  section: string;
  /** A PDF or another file download rather than a web page. */
  is_document: boolean;
  /** Answers citing the page. */
  citations: number;
  engines: string[];
}

export interface OwnedSectionRow {
  section: string;
  citations: number;
  document_citations: number;
  pages: number;
}

export interface OwnedPagesEngineRow {
  engine: string;
  document_citations: number;
  page_citations: number;
}

export interface OwnedPagesFacts {
  /** The 25 most-cited owned pages. */
  pages: OwnedPageRow[];
  /** Owned pages left out beyond the 25. */
  pages_omitted: number;
  sections: OwnedSectionRow[];
  /** Each engine citing an owned page. */
  engines: OwnedPagesEngineRow[];
  document_citations: number;
  page_citations: number;
}

/** A competitor named in the latest runs: its mentions worded mixed or negative, and why. */
export interface CompetitorCaveatRow {
  name: string;
  mentions: number;
  mixed: number;
  negative: number;
  /** Mixed and negative mentions as a percent of all its mentions. */
  caveat_share: number | null;
  /** Up to three distinct reasons the answers give. */
  reasons: string[];
}

export interface InsightFacts {
  /** One row per engine that answered, in engine order. */
  engines: EnginePlayRow[];
  prompt_engine: PromptEngineFacts;
  citation_ownership: CitationOwnershipFacts;
  owned_pages: OwnedPagesFacts;
  /** Most-mentioned competitor first. */
  competitor_caveats: CompetitorCaveatRow[];
  /** Empty unless two first-party brands qualify. */
  portfolio: PortfolioBrandRow[];
  /** Group scope only; empty for every other scope. */
  stability: KeywordStabilityRow[];
}

export type InsightKind = 'engine_play' | 'weak_subbrand' | 'unstable_keyword' | 'competitor_sites' | 'documents_cited' | 'competitor_caveat'
  | 'prompt_gap';

export type InsightSeverity = 'high' | 'medium' | 'low';

/** The custom-report block that shows the detail behind an insight. */
export type InsightBlock = 'insights_engine_playbook' | 'insights_brand_portfolio' | 'insights_run_stability' | 'insights_citation_ownership'
  | 'insights_owned_pages' | 'insights_competitor_caveats' | 'insights_prompt_engine';

/** Every number an insight rests on, by its name in `facts`; the engine play rides along as a string. */
export type InsightEvidence = Readonly<Record<string, number | string | null>>;

export interface Insight {
  /** `kind:subject`. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** The engine, brand, competitor or keyword the insight is about. */
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
  /** The written narrative stored for a keyword group's latest run; `null` for other scopes and while none is stored. */
  narrative: InsightsNarrative | null;
}
