/**
 * Research-agent brief: the expansion dimensions, market options and the
 * cost estimate shown before a run starts. Mirrors the limits in
 * `lambda/shared/research_agent.py`.
 */
import type { AgentDimension } from '../../../types';

export const AGENT_MAX_QUERIES_PER_ROUND = 8;
export const AGENT_MAX_ROUNDS = 3;
export const AGENT_DEFAULT_ROUNDS = 2;
export const AGENT_DEFAULT_TARGET_COUNT = 60;
export const AGENT_MIN_TARGET_COUNT = 10;
export const AGENT_MAX_TARGET_COUNT = 100;
export const AGENT_INSTRUCTION_MAX_LENGTH = 1000;
export const SYSTEM_PROMPT_MAX_LENGTH = 6000;
export const SYSTEM_PROMPT_MIN_LENGTH = 20;
export const BUILTIN_TEMPLATE_ID = 'builtin-default';

export interface DimensionOption {
  id: AgentDimension;
  label: string;
  hint: string;
}

/** Order matches the customer's list (R19). */
export const DIMENSION_OPTIONS: readonly DimensionOption[] = [
  {
    id: 'destination',
    label: 'Destination',
    hint: 'the city or region as a place to stay',
  },
  {
    id: 'location',
    label: 'Location / neighbourhood',
    hint: '"hotel near …", landmarks and areas around the hotel',
  },
  {
    id: 'points_of_interest',
    label: 'Points of interest',
    hint: 'attractions, venues and events people travel for',
  },
  {
    id: 'hotel_attributes',
    label: 'Hotel attributes',
    hint: 'pool, spa, parking, pet friendly, sea view, breakfast…',
  },
  {
    id: 'audience',
    label: 'Audience',
    hint: 'families, couples, business travellers, groups, solo',
  },
  {
    id: 'trip_type',
    label: 'Trip type',
    hint: 'weekend break, honeymoon, conference, golf, beach holiday',
  },
];

const DIMENSION_LABELS: Record<string, string> = Object.fromEntries(
  DIMENSION_OPTIONS.map((option) => [option.id, option.label])
);

/** Human label for a dimension id; the model's `other` bucket and unknown ids read as "Other". */
export function dimensionLabel(dimension: string | undefined): string {
  if (dimension === undefined) return 'Other';
  return DIMENSION_LABELS[dimension] ?? 'Other';
}

export const DEFAULT_DIMENSIONS: readonly AgentDimension[] = ['destination', 'location', 'points_of_interest', 'hotel_attributes', 'audience', 'trip_type'];

export interface MarketOption {
  code: string;
  label: string;
}

/** Markets the hotel group sells in first; any other ISO code can be typed. */
export const COUNTRY_OPTIONS: readonly MarketOption[] = [
  {
    code: 'es',
    label: 'Spain (es)',
  },
  {
    code: 'pt',
    label: 'Portugal (pt)',
  },
  {
    code: 'fr',
    label: 'France (fr)',
  },
  {
    code: 'it',
    label: 'Italy (it)',
  },
  {
    code: 'de',
    label: 'Germany (de)',
  },
  {
    code: 'gb',
    label: 'United Kingdom (gb)',
  },
  {
    code: 'ie',
    label: 'Ireland (ie)',
  },
  {
    code: 'nl',
    label: 'Netherlands (nl)',
  },
  {
    code: 'us',
    label: 'United States (us)',
  },
  {
    code: 'mx',
    label: 'Mexico (mx)',
  },
  {
    code: 'ar',
    label: 'Argentina (ar)',
  },
  {
    code: 'cl',
    label: 'Chile (cl)',
  },
  {
    code: 'br',
    label: 'Brazil (br)',
  },
];

export const LANGUAGE_OPTIONS: readonly MarketOption[] = [
  {
    code: 'es',
    label: 'Spanish (es)',
  },
  {
    code: 'en',
    label: 'English (en)',
  },
  {
    code: 'pt',
    label: 'Portuguese (pt)',
  },
  {
    code: 'fr',
    label: 'French (fr)',
  },
  {
    code: 'it',
    label: 'Italian (it)',
  },
  {
    code: 'de',
    label: 'German (de)',
  },
  {
    code: 'nl',
    label: 'Dutch (nl)',
  },
  {
    code: 'ca',
    label: 'Catalan (ca)',
  },
  {
    code: 'gl',
    label: 'Galician (gl)',
  },
];

export interface AgentCostEstimate {
  /** Web-search LLM calls: queries per round × rounds (upper bound). */
  webSearches: number;
  /** Bedrock calls: one plan, one evaluation per round, one final selection. */
  modelCalls: number;
  /** SerpAPI calls when a key is configured: two per query (related + autocomplete). */
  googleSignalCalls: number;
}

/**
 * Upper bound of what a run can cost in provider calls, shown next to the
 * Start button so the operator knows before launching (Epic E guardrail).
 */
export function estimateAgentCost(maxRounds: number): AgentCostEstimate {
  const rounds = Math.min(Math.max(1, Math.trunc(maxRounds)), AGENT_MAX_ROUNDS);
  const queries = AGENT_MAX_QUERIES_PER_ROUND * rounds;
  return {
    webSearches: queries,
    modelCalls: 2 + rounds,
    googleSignalCalls: queries * 2,
  };
}

export function formatAgentCost(estimate: AgentCostEstimate): string {
  return `Up to ${estimate.webSearches} web searches, ${estimate.modelCalls} model calls`
    + ` and ${estimate.googleSignalCalls} Google signal lookups (when SerpAPI is configured).`;
}

/** Validation the form applies before calling the API (the API re-checks). */
export function briefProblems(brief: {
  seed: string;
  dimensions: readonly AgentDimension[];
  country: string;
  language: string;
  systemPrompt: string;
}): string[] {
  const problems: string[] = [];
  if (brief.seed.trim().length < 2) problems.push('Enter the hotel name (or a seed keyword).');
  if (brief.dimensions.length === 0) problems.push('Pick at least one expansion dimension.');
  if (!/^[a-z]{2}$/i.test(brief.country.trim())) problems.push('Country must be a two-letter code (e.g. es).');
  if (!/^[a-z]{2}$/i.test(brief.language.trim())) problems.push('Language must be a two-letter code (e.g. es).');
  if (brief.systemPrompt.trim().length < SYSTEM_PROMPT_MIN_LENGTH) problems.push('The agent instructions are too short.');
  if (brief.systemPrompt.length > SYSTEM_PROMPT_MAX_LENGTH) problems.push(`The agent instructions exceed ${SYSTEM_PROMPT_MAX_LENGTH} characters.`);
  return problems;
}
