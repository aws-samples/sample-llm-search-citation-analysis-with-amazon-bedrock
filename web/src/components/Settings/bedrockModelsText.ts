/**
 * The words Settings › Bedrock models uses for tiers, roles, request styles
 * and test results.
 */
import type {
  BedrockFailureReason, BedrockModelOption, BedrockModelQuota, BedrockModelTest, BedrockRequestStyle, BedrockTierId
} from '../../api/bedrockModels';

export const TIER_LABELS: Readonly<Record<BedrockTierId, string>> = {
  fast: 'Fast',
  balanced: 'Balanced',
  deep: 'Deep',
};

const ROLE_WORDS: Readonly<Record<string, string>> = {
  summarization: 'page summaries',
  extraction: 'brand extraction',
  generation: 'Content Studio',
  analysis: 'analysis and recommendations',
  research_planning: 'research planning',
  research_evaluation: 'research evaluation',
};

export const REQUEST_STYLE_LABELS: Readonly<Record<BedrockRequestStyle, string>> = {
  adaptive: 'Adaptive thinking',
  budget: 'Thinking budget',
};

const FAILURE_SENTENCES: Readonly<Record<Exclude<BedrockFailureReason, 'error'>, string>> = {
  not_subscribed: "Not subscribed in this account. Bedrock subscribes a model the first time it's invoked by a role "
    + 'that may subscribe; deploy the stack with this model in the list, or invoke it once from the console.',
  access_denied: 'Access denied for this model.',
  no_capacity: "This account's quota for this model is 0 tokens per minute, so it can't be used yet. "
    + 'Nothing to do but wait for the quota to be raised.',
  throttled: 'The model is at capacity right now (throttled). Try the test again later.',
  unsupported: "This model doesn't accept the requests the app sends.",
  unavailable: 'This model is no longer available.',
};

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** What a tier is used for, in plain words, from the roles it serves. */
export function describeTierUse(roles: readonly string[]): string {
  if (roles.length === 0) return 'Not used by default';
  return `Used for ${joinWords(roles.map((role) => ROLE_WORDS[role] ?? role.replaceAll('_', ' ')))}.`;
}

/** The display name of `modelId`, or the id itself when the account does not list it. */
export function modelName(models: readonly BedrockModelOption[], modelId: string): string {
  return models.find((model) => model.id === modelId)?.name ?? modelId;
}

const COMPACT_NUMBER = new Intl.NumberFormat('en', { notation: 'compact' });

/**
 * e.g. "6M tokens/min"; "quota still being read" while the account's quotas are
 * read for the first time; otherwise "quota not reported" (no such quota, or
 * Service Quotas could not be read).
 */
function describeQuota(quota: BedrockModelQuota | null): string {
  const tokensPerMinute = quota?.tokens_per_minute ?? null;
  if (tokensPerMinute !== null) return `${COMPACT_NUMBER.format(tokensPerMinute)} tokens/min`;
  return quota?.complete === false ? 'quota still being read' : 'quota not reported';
}

/** One sentence for a test result: "Works · 930 ms · 6M tokens/min", or why it failed. */
export function describeTestResult(result: BedrockModelTest): string {
  if (result.valid) return `Works · ${result.latency_ms} ms · ${describeQuota(result.quota)}`;
  if (result.reason === 'error') return result.error ?? 'The test failed.';
  // An unsupported model's server message names the cause (e.g. the account's data retention mode).
  if (result.reason === 'unsupported' && result.error) return `${FAILURE_SENTENCES.unsupported} ${result.error}`;
  return FAILURE_SENTENCES[result.reason];
}
