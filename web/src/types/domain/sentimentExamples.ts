/**
 * `GET /visibility/sentiment-examples`: the first-party sightings behind one
 * sentiment count of the per-engine sentiment split (each keyword's latest
 * run in the scope, one sighting per brand per answer at its best rank).
 */
import type { ReportScopeInfo } from './baseTypes';
import type { SentimentSplit } from './groupKpiHistory';
import { isRecord } from './keywordDecoders';

/** A sentiment label the extraction assigns to a brand. */
export type SentimentLabel = keyof SentimentSplit;

const SENTIMENT_LABELS: ReadonlySet<unknown> = new Set<SentimentLabel>(['positive', 'neutral', 'mixed', 'negative']);

/** One answer's sighting of a first-party brand with the requested sentiment. */
export interface SentimentExample {
  keyword: string;
  provider: string;
  persona: string;
  /** `null` when the run has no persona name. */
  persona_name: string | null;
  timestamp: string;
  brand: string;
  /** The brand's best rank in the answer. */
  rank: number | null;
  sentiment: SentimentLabel;
  /** The verbatim passage carrying the sentiment; `null` on rows extracted before quotes existed. */
  quote: string | null;
  /** Why the answer was labelled so (the model's explanation, not a quote). */
  reason: string | null;
  ranking_context: string | null;
  /** The full answer, at most 20 000 characters. */
  answer: string;
  answer_truncated: boolean;
}

export interface SentimentExamplesResponse {
  scope: ReportScopeInfo;
  keywords_truncated: boolean;
  sentiment: SentimentLabel;
  /** The AI engine the examples are limited to; `null` for every engine. */
  provider: string | null;
  /** Every matching sighting in the scope; `examples` holds the first ones. */
  total: number;
  /** Newest run first, then keyword, engine and brand. */
  examples: SentimentExample[];
}

function isSentimentLabel(value: unknown): value is SentimentLabel {
  return SENTIMENT_LABELS.has(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function hasExampleText(value: Record<string, unknown>): boolean {
  return typeof value.keyword === 'string'
    && typeof value.provider === 'string'
    && typeof value.persona === 'string'
    && typeof value.timestamp === 'string'
    && typeof value.brand === 'string'
    && typeof value.answer === 'string';
}

function hasSentimentDetail(value: Record<string, unknown>): boolean {
  return isNullableString(value.persona_name)
    && isNullableString(value.quote)
    && isNullableString(value.reason)
    && isNullableString(value.ranking_context);
}

function isSentimentExample(value: unknown): value is SentimentExample {
  return isRecord(value)
    && hasExampleText(value)
    && hasSentimentDetail(value)
    && (value.rank === null || typeof value.rank === 'number')
    && isSentimentLabel(value.sentiment)
    && typeof value.answer_truncated === 'boolean';
}

export function isSentimentExamplesResponse(value: unknown): value is SentimentExamplesResponse {
  return isRecord(value)
    && isRecord(value.scope)
    && typeof value.keywords_truncated === 'boolean'
    && isSentimentLabel(value.sentiment)
    && isNullableString(value.provider)
    && typeof value.total === 'number'
    && Array.isArray(value.examples)
    && value.examples.every(isSentimentExample);
}
