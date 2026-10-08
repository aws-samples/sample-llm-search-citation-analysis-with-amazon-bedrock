/**
 * Wire payloads of the Bedrock model picker endpoints, shaped as in
 * `.kiro/specs/bedrock-model-picker.md`.
 */
import type {
  BedrockFailureReason, BedrockModelListing, BedrockModelQuota, BedrockModelTest, BedrockTier
} from './bedrockModels';

export const HAIKU_5_5 = 'global.anthropic.claude-haiku-5-5';
export const SONNET_5_5 = 'global.anthropic.claude-sonnet-5-5';
export const OPUS_5_5 = 'global.anthropic.claude-opus-5-5';
export const SONNET_4_5 = 'global.anthropic.claude-sonnet-4-5';

export const BEDROCK_MODEL_OPTIONS = [
  {
    id: HAIKU_5_5,
    name: 'Claude Haiku 5.5',
  },
  {
    id: OPUS_5_5,
    name: 'Claude Opus 5.5',
  },
  {
    id: SONNET_4_5,
    name: 'Claude Sonnet 4.5',
  },
  {
    id: SONNET_5_5,
    name: 'Claude Sonnet 5.5',
  },
];

export function buildBedrockTier(overrides: Partial<BedrockTier> = {}): BedrockTier {
  return {
    tier: 'fast',
    model: HAIKU_5_5,
    default_model: HAIKU_5_5,
    is_default: true,
    request_style: 'adaptive',
    model_updated_at: null,
    tested_at: null,
    roles: ['summarization', 'extraction', 'generation', 'research_evaluation'],
    ...overrides,
  };
}

export const BALANCED_AT_DEFAULT = buildBedrockTier({
  tier: 'balanced',
  model: SONNET_5_5,
  default_model: SONNET_5_5,
  roles: ['analysis', 'research_planning'],
});

export const DEEP_AT_DEFAULT = buildBedrockTier({
  tier: 'deep',
  model: OPUS_5_5,
  default_model: OPUS_5_5,
  request_style: null,
  roles: [],
});

/** Balanced moved to Sonnet 4.5 on 2026-10-08. */
export const BALANCED_ON_SONNET_4_5 = {
  ...BALANCED_AT_DEFAULT,
  model: SONNET_4_5,
  is_default: false,
  request_style: 'budget',
  model_updated_at: '2026-10-08T09:00:00Z',
  tested_at: '2026-10-08T09:00:00Z',
} satisfies BedrockTier;

export function buildBedrockListing(balanced: BedrockTier = BALANCED_AT_DEFAULT): BedrockModelListing {
  return {
    tiers: [buildBedrockTier(), balanced, DEEP_AT_DEFAULT],
    models: BEDROCK_MODEL_OPTIONS,
  };
}

/** A passing `POST /providers/bedrock/validate` answer, as sent on the wire. */
export function buildPassedTestPayload(model: string, tokensPerMinute: number | null = 6_000_000, complete = true) {
  return {
    valid: true,
    model,
    request_style: 'adaptive',
    latency_ms: 930,
    quota: {
      tokens_per_minute: tokensPerMinute,
      requests_per_minute: null,
      complete,
    },
    reason: null,
    error: null,
  };
}

/** The decoded `buildPassedTestPayload(model)` answer: adaptive, 930 ms, 6M tokens/min, complete reading. */
export function buildDecodedPassedTest(model: string): BedrockModelTest {
  return {
    valid: true,
    model,
    request_style: 'adaptive',
    latency_ms: 930,
    quota: {
      tokens_per_minute: 6_000_000,
      requests_per_minute: null,
      complete: true,
    },
  };
}

/** A decoded passing test of Sonnet 5.5 (412 ms, budget style) with `quota`. */
export function buildPassedTest(quota: Partial<BedrockModelQuota> | null): BedrockModelTest {
  return {
    valid: true,
    model: SONNET_5_5,
    request_style: 'budget',
    latency_ms: 412,
    quota: quota === null ? null : {
      tokens_per_minute: null,
      requests_per_minute: 50,
      complete: true,
      ...quota,
    },
  };
}

/** A failing `POST /providers/bedrock/validate` answer, as sent on the wire. */
export function buildFailedTestPayload(model: string, reason: BedrockFailureReason, error: string | null = null) {
  return {
    valid: false,
    model,
    request_style: null,
    latency_ms: null,
    quota: null,
    reason,
    error,
  };
}

/** A request that never reached the Bedrock endpoints (offline, 5xx). */
export class BedrockOutageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockOutageError';
  }
}

/** The `apiPut` arguments that return the balanced tier to its default model. */
export const RESTORE_BALANCED_DEFAULT_REQUEST = [
  '/providers/bedrock',
  {
    tier: 'balanced',
    model: null,
    validate: true,
  },
  { acceptedJsonStatuses: [400] },
] as const;
