/**
 * Research-agent brief: the market options, the template-driven copy and the
 * cost estimate shown before a run starts. Mirrors the limits in
 * `lambda/shared/research_agent.py`. Dimension labels always come from the
 * template's catalogue (snapshotted on the run as `dimension_catalog`).
 */
import type {
  AgentDimensionOption, KeywordResearchItem
} from '../../../types';

export const AGENT_MAX_QUERIES_PER_ROUND = 8;
export const AGENT_MAX_ROUNDS = 3;
export const AGENT_DEFAULT_ROUNDS = 2;
export const AGENT_DEFAULT_TARGET_COUNT = 60;
export const AGENT_MIN_TARGET_COUNT = 10;
export const AGENT_MAX_TARGET_COUNT = 100;
export const AGENT_DEFAULT_TRACKING_COUNT = 15;
export const AGENT_MIN_TRACKING_COUNT = 1;
export const AGENT_MAX_TRACKING_COUNT = 50;
export const AGENT_INSTRUCTION_MAX_LENGTH = 1000;
export const SYSTEM_PROMPT_MAX_LENGTH = 6000;
export const SYSTEM_PROMPT_MIN_LENGTH = 20;
export const BUILTIN_TEMPLATE_ID = 'builtin-default';

/** The model's catch-all bucket; never a catalogue id. */
export const OTHER_DIMENSION_ID = 'other';

/** Human label for a dimension id; the model's `other` bucket and ids the catalogue does not know read as "Other". */
export function dimensionLabel(dimension: string | undefined, catalog: readonly AgentDimensionOption[]): string {
  return catalog.find((option) => option.id === dimension)?.label ?? 'Other';
}

/** The dimension catalogue a run was started with (backfilled by the API on legacy rows). */
export function runCatalog(job: KeywordResearchItem): AgentDimensionOption[] {
  return job.config?.dimension_catalog ?? [];
}

/** Section order for a proposal: the catalogue's order, then the `other` bucket. */
export function orderedDimensionIds(catalog: readonly AgentDimensionOption[]): string[] {
  return [...catalog.map((option) => option.id), OTHER_DIMENSION_ID];
}

/** "café" → "Café", for labels that start a sentence or a field name. */
export function subjectLabel(subject: string): string {
  return subject.charAt(0).toLocaleUpperCase() + subject.slice(1);
}

/** "Research a hotel" / "Research an inn". */
export function subjectHeading(subject: string): string {
  const article = /^[aeiouáéíóú]/i.test(subject) ? 'an' : 'a';
  return `Research ${article} ${subject}`;
}

const SEED_PLACEHOLDERS: Record<string, string> = {
  hotel: 'e.g. Hotel Gran Marino',
  restaurant: 'e.g. Casa Lucio',
  café: 'e.g. Café Central',
  store: 'e.g. Zara Gran Vía',
};

/** An example seed for the template's subject. */
export function seedPlaceholder(subject: string): string {
  return SEED_PLACEHOLDERS[subject.trim().toLocaleLowerCase()] ?? 'e.g. your business name';
}

export interface MarketOption {
  code: string;
  label: string;
}

/** Markets offered first; any other ISO code can be typed. */
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
  subject: string;
  dimensions: readonly string[];
  country: string;
  language: string;
  targetCount: number;
  trackingCount: number;
  systemPrompt: string;
}): string[] {
  const problems: string[] = [];
  if (brief.seed.trim().length < 2) problems.push(`Enter the ${brief.subject} name (or a seed keyword).`);
  if (brief.dimensions.length === 0) problems.push('Pick at least one expansion dimension.');
  if (!/^[a-z]{2}$/i.test(brief.country.trim())) problems.push('Country must be a two-letter code (e.g. es).');
  if (!/^[a-z]{2}$/i.test(brief.language.trim())) problems.push('Language must be a two-letter code (e.g. es).');
  if (brief.trackingCount < AGENT_MIN_TRACKING_COUNT || brief.trackingCount > AGENT_MAX_TRACKING_COUNT) {
    problems.push(`Tracking keywords must be between ${AGENT_MIN_TRACKING_COUNT} and ${AGENT_MAX_TRACKING_COUNT}.`);
  }
  if (brief.trackingCount > brief.targetCount) problems.push('Tracking keywords cannot exceed target keywords.');
  if (brief.systemPrompt.trim().length < SYSTEM_PROMPT_MIN_LENGTH) problems.push('The agent instructions are too short.');
  if (brief.systemPrompt.length > SYSTEM_PROMPT_MAX_LENGTH) problems.push(`The agent instructions exceed ${SYSTEM_PROMPT_MAX_LENGTH} characters.`);
  return problems;
}
