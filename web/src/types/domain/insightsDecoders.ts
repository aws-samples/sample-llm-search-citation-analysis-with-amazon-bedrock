/**
 * Runtime guards for `GET /reports/insights` (`./insights`): the facts per
 * engine, brand and keyword, the typed insights and the (still null)
 * narrative. A payload failing any of them is reported as an invalid
 * response rather than rendered half-right.
 */
import type {
  EnginePlay, EnginePlayRow, Insight, InsightBlock, InsightFacts, InsightKind, InsightSeverity, KeywordStabilityRow, PortfolioBrandRow,
  ReportInsightsResponse
} from './insights';
import { isRecord } from './keywordDecoders';

const ENGINE_PLAYS: ReadonlySet<unknown> = new Set<EnginePlay>(['get_cited', 'get_ranked_first', 'get_mentioned_and_cited', 'defend']);
const INSIGHT_KINDS: ReadonlySet<unknown> = new Set<InsightKind>(['engine_play', 'weak_subbrand', 'unstable_keyword']);
const INSIGHT_SEVERITIES: ReadonlySet<unknown> = new Set<InsightSeverity>(['high', 'medium', 'low']);
const INSIGHT_BLOCKS: ReadonlySet<unknown> = new Set<InsightBlock>(['insights_engine_playbook', 'insights_brand_portfolio', 'insights_run_stability']);

export function isEnginePlay(value: unknown): value is EnginePlay {
  return ENGINE_PLAYS.has(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isEnginePlayRow(value: unknown): value is EnginePlayRow {
  return isRecord(value)
    && typeof value.engine === 'string'
    && isEnginePlay(value.play)
    && isRecord(value.kpis);
}

function isPortfolioBrandRow(value: unknown): value is PortfolioBrandRow {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.mentions === 'number'
    && isNullableNumber(value.average_position)
    && isNullableNumber(value.net_sentiment)
    && isNullableNumber(value.citations)
    && isNullableNumber(value.position_gap)
    && isNullableNumber(value.sentiment_gap)
    && typeof value.weak === 'boolean';
}

function isKeywordStabilityRow(value: unknown): value is KeywordStabilityRow {
  return isRecord(value)
    && typeof value.keyword === 'string'
    && typeof value.runs === 'number'
    && typeof value.position_min === 'number'
    && typeof value.position_max === 'number'
    && typeof value.position_range === 'number'
    && typeof value.flips === 'number'
    && typeof value.unstable === 'boolean';
}

function isInsightFacts(value: unknown): value is InsightFacts {
  return isRecord(value)
    && Array.isArray(value.engines)
    && value.engines.every(isEnginePlayRow)
    && Array.isArray(value.portfolio)
    && value.portfolio.every(isPortfolioBrandRow)
    && Array.isArray(value.stability)
    && value.stability.every(isKeywordStabilityRow);
}

function isEvidenceValue(value: unknown): boolean {
  return value === null || typeof value === 'number' || typeof value === 'string';
}

function isInsight(value: unknown): value is Insight {
  return isRecord(value)
    && typeof value.id === 'string'
    && INSIGHT_KINDS.has(value.kind)
    && INSIGHT_SEVERITIES.has(value.severity)
    && typeof value.subject === 'string'
    && isRecord(value.evidence)
    && Object.values(value.evidence).every(isEvidenceValue)
    && INSIGHT_BLOCKS.has(value.block);
}

/** The scope fields the endpoint shares with `GET /visibility`. */
function hasScopeFields(value: Record<string, unknown>): boolean {
  return isRecord(value.scope)
    && typeof value.keywords_truncated === 'boolean'
    && (value.timestamp === null || typeof value.timestamp === 'string')
    && typeof value.keywords_analyzed === 'number'
    && typeof value.keywords_with_data === 'number'
    && typeof value.citations_configured === 'boolean';
}

export function isReportInsightsResponse(value: unknown): value is ReportInsightsResponse {
  return isRecord(value)
    && hasScopeFields(value)
    && isInsightFacts(value.facts)
    && Array.isArray(value.insights)
    && value.insights.every(isInsight)
    && (value.narrative === null || isRecord(value.narrative));
}
