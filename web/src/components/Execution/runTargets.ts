import { PROVIDER } from '../../constants/providers';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import type { QueryPrompt } from '../../types';

/** What each keyword of a run is sent to, as Settings has it now. */
export interface RunTargets {
  /** Answer engines that take the persona prompts (OpenAI, Perplexity, Gemini, Claude). */
  readonly chatEngines: readonly string[];
  /** Google AI Overviews is on: it is asked the plain keyword once, whatever the personas. */
  readonly aiOverviews: boolean;
  /** Names of the enabled personas. */
  readonly personas: readonly string[];
}

const isReady = (provider: ProviderConfig) => provider.enabled && provider.configured;

/** The ready answer engines and the enabled personas, by the rules the run applies. */
export function runTargetsFrom(providers: readonly ProviderConfig[], prompts: readonly QueryPrompt[]): RunTargets {
  const engines = providers.filter((provider) => provider.type === 'llm' && isReady(provider));
  return {
    chatEngines: engines.filter((engine) => engine.id !== PROVIDER.GOOGLE_AI_OVERVIEW).map((engine) => engine.name),
    aiOverviews: engines.some((engine) => engine.id === PROVIDER.GOOGLE_AI_OVERVIEW),
    personas: prompts.filter((prompt) => prompt.enabled === 'true').map((prompt) => prompt.name),
  };
}

export function engineCount(targets: RunTargets): number {
  return targets.chatEngines.length + (targets.aiOverviews ? 1 : 0);
}

/**
 * The most answers a run can record: every keyword once per persona (once
 * when there is none) to each chat engine, plus one AI Overview per keyword.
 */
export function maxAnswers(keywordCount: number, targets: RunTargets): number {
  const perKeyword = targets.chatEngines.length * Math.max(1, targets.personas.length) + (targets.aiOverviews ? 1 : 0);
  return keywordCount * perKeyword;
}

/** "1 answer", "1,200 answers". */
export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

/** "3 AI engines: OpenAI, Perplexity, Google AI Overviews". */
export function describeEngines(targets: RunTargets): string {
  const names = [...targets.chatEngines, ...(targets.aiOverviews ? ['Google AI Overviews'] : [])];
  return `${plural(names.length, 'AI engine')}: ${names.join(', ')}`;
}

/** "2 personas: Family traveler, Business" / "No personas: each keyword is asked as written". */
export function describePersonas(targets: RunTargets): string {
  if (targets.personas.length === 0) return 'No personas: each keyword is asked as written';
  return `${plural(targets.personas.length, 'persona')}: ${targets.personas.join(', ')}`;
}

/** "Up to 498 answers, each a billed request to an AI engine." */
export function describeAnswers(keywordCount: number, targets: RunTargets): string {
  return `Up to ${plural(maxAnswers(keywordCount, targets), 'answer')}, each a billed request to an AI engine.`;
}
