import { providerName } from '../../../constants/providers';
import {
  EMPTY_KPI, formatKpi
} from '../../../formatting/kpiFormatter';
import type {
  EnginePlay, Insight, InsightEvidence
} from '../../../types/domain/insights';
import { isEnginePlay } from '../../../types/domain/insightsDecoders';

/**
 * How an insight is worded: one sentence per insight, built from its
 * `evidence` alone, so the sentence and the table it sits above quote the
 * same figures. Nothing here recomputes a number.
 */

/** The play of each AI engine, as the chip and the sentence name it. */
export const PLAY_LABELS: Readonly<Record<EnginePlay, string>> = {
  get_cited: 'Get cited',
  get_ranked_first: 'Get ranked first',
  get_mentioned_and_cited: 'Get mentioned and cited',
  defend: 'Defend',
};

/** How the play is chosen, for the column tooltip. */
export const PLAY_INFO = 'What to do about the engine. Get cited: it ranks you first in half its answers or more but links to your '
  + 'domains in under 30%. Get ranked first: it links to you in 30% or more but ranks you first in under half. Get mentioned and '
  + 'cited: both are below those marks. Defend: both are at or above them. Without owned domains, the top-1 share alone decides.';

/** A gap in places or points, two or one decimal; an em dash when unknown. */
export function formatGap(value: number | null, digits: number): string {
  return value === null ? EMPTY_KPI : value.toFixed(digits);
}

function numberOf(evidence: InsightEvidence, key: string): number | null {
  const value = evidence[key];
  return typeof value === 'number' ? value : null;
}

function playOf(evidence: InsightEvidence): string {
  const { play } = evidence;
  return isEnginePlay(play) ? PLAY_LABELS[play].toLowerCase() : 'unknown';
}

/** ", links to a tracked domain in 80.0%" or "; citation rate not measured" when no owned domain is configured. */
function citationClause(citationRate: number | null): string {
  return citationRate === null ? '; citation rate not measured' : `, links to a tracked domain in ${formatKpi('citation_rate', citationRate)}`;
}

function enginePlaySentence(insight: Insight): string {
  const { evidence } = insight;
  return `${providerName(insight.subject)}: ranked first in ${formatKpi('top_1_share', numberOf(evidence, 'top_1_share'))} of answers`
    + `${citationClause(numberOf(evidence, 'citation_rate'))}. Play: ${playOf(evidence)}.`;
}

/** " (2.70 places behind your best brand)"; nothing for the best brand or an unknown gap. */
function gapNote(gap: number | null, digits: number, unit: string): string {
  return gap === null || gap === 0 ? '' : ` (${formatGap(gap, digits)} ${unit} behind your best brand)`;
}

function weakSubbrandSentence(insight: Insight): string {
  const { evidence } = insight;
  return `${insight.subject}: named in ${formatKpi('mentions', numberOf(evidence, 'mentions'))} answers`
    + ` at average position ${formatKpi('average_position', numberOf(evidence, 'average_position'))}`
    + `${gapNote(numberOf(evidence, 'position_gap'), 2, 'places')}`
    + `, net sentiment ${formatKpi('net_sentiment', numberOf(evidence, 'net_sentiment'))}`
    + `${gapNote(numberOf(evidence, 'sentiment_gap'), 1, 'points')}.`;
}

function plural(count: number | null, noun: string): string {
  return `${count ?? EMPTY_KPI} ${noun}${count === 1 ? '' : 's'}`;
}

function unstableKeywordSentence(insight: Insight): string {
  const { evidence } = insight;
  return `${insight.subject}: placed between ${formatKpi('average_position', numberOf(evidence, 'position_min'))}`
    + ` and ${formatKpi('average_position', numberOf(evidence, 'position_max'))} over ${plural(numberOf(evidence, 'runs'), 'run')}`
    + `, a swing of ${formatGap(numberOf(evidence, 'position_range'), 2)} places, with ${plural(numberOf(evidence, 'flips'), 'mention flip')}.`;
}

const SENTENCES: Readonly<Record<Insight['kind'], (insight: Insight) => string>> = {
  engine_play: enginePlaySentence,
  weak_subbrand: weakSubbrandSentence,
  unstable_keyword: unstableKeywordSentence,
};

/** The one-line reading of an insight, every figure quoted from its evidence. */
export function insightSentence(insight: Insight): string {
  return SENTENCES[insight.kind](insight);
}
