/**
 * Bedrock model picker API client (Settings > Bedrock models).
 *
 * Each processing tier (fast, balanced, deep) runs on a Claude model through
 * Amazon Bedrock. An administrator lists the models the account can use,
 * tests one (a real Converse call plus the account's quota), and saves it;
 * the server tests again before storing. A save refusal carries the reason in
 * `details`, so 400 bodies are read here instead of being flattened into a
 * bare status by the shared client.
 */
import {
  apiGet, apiPost, apiPut
} from './client';
import {
  isAllowedString, isFiniteNumber, isNullableString, isRecord, isStringArray
} from './contentStudioDecoderPrimitives';
import { refusalMessage } from './providerModels';

export class BedrockModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockModelError';
  }
}

export const BEDROCK_TIERS = ['fast', 'balanced', 'deep'] as const;
export type BedrockTierId = (typeof BEDROCK_TIERS)[number];

const REQUEST_STYLES = ['adaptive', 'budget'] as const;
export type BedrockRequestStyle = (typeof REQUEST_STYLES)[number];

const FAILURE_REASONS = [
  'not_subscribed', 'access_denied', 'no_capacity', 'throttled', 'unsupported', 'unavailable', 'error',
] as const;
export type BedrockFailureReason = (typeof FAILURE_REASONS)[number];

export interface BedrockTier {
  tier: BedrockTierId;
  /** The model the tier runs on now. */
  model: string;
  /** The model the tier runs on when nothing is saved. */
  default_model: string;
  is_default: boolean;
  /** How the app talks to `model`, when known. */
  request_style: BedrockRequestStyle | null;
  model_updated_at: string | null;
  tested_at: string | null;
  /** Bedrock roles (summarization, extraction, ...) served by this tier. */
  roles: string[];
}

export interface BedrockModelOption {
  id: string;
  name: string;
}

export interface BedrockModelListing {
  /** Always fast, balanced, deep in that order. */
  tiers: BedrockTier[];
  models: BedrockModelOption[];
}

export interface BedrockModelQuota {
  tokens_per_minute: number | null;
  requests_per_minute: number | null;
  /**
   * The account's quotas have been read in full at least once, so a missing
   * quota means there is none; `false` while the first reading is under way
   * (servers that predate the field mean `true`).
   */
  complete: boolean;
}

export type BedrockModelTest =
  | {
    valid: true;
    model: string;
    request_style: BedrockRequestStyle;
    latency_ms: number;
    quota: BedrockModelQuota | null;
  }
  | {
    valid: false;
    model: string;
    reason: BedrockFailureReason;
    error: string | null;
  };

const BEDROCK_PATH = '/providers/bedrock';

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isBedrockTier(value: unknown): value is BedrockTier {
  return isRecord(value)
    && isAllowedString(value.tier, BEDROCK_TIERS)
    && typeof value.model === 'string'
    && typeof value.default_model === 'string'
    && typeof value.is_default === 'boolean'
    && (value.request_style === null || isAllowedString(value.request_style, REQUEST_STYLES))
    && isNullableString(value.model_updated_at)
    && isNullableString(value.tested_at)
    && isStringArray(value.roles);
}

function toBedrockTier(value: BedrockTier): BedrockTier {
  return {
    tier: value.tier,
    model: value.model,
    default_model: value.default_model,
    is_default: value.is_default,
    request_style: value.request_style,
    model_updated_at: value.model_updated_at,
    tested_at: value.tested_at,
    roles: [...value.roles],
  };
}

function isModelOption(value: unknown): value is BedrockModelOption {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

/** `tiers` holds exactly fast, balanced and deep, in that order. */
function hasEveryTierInOrder(tiers: readonly BedrockTier[]): boolean {
  return tiers.length === BEDROCK_TIERS.length && tiers.every((tier, index) => tier.tier === BEDROCK_TIERS[index]);
}

function decodeBedrockModelListing(payload: unknown): BedrockModelListing {
  if (!isRecord(payload) || !Array.isArray(payload.tiers) || !Array.isArray(payload.models)) {
    throw new BedrockModelError('Bedrock API returned an invalid model list');
  }
  const {
    tiers, models 
  } = payload;
  if (!tiers.every(isBedrockTier) || !hasEveryTierInOrder(tiers) || !models.every(isModelOption)) {
    throw new BedrockModelError('Bedrock API returned an invalid model list');
  }
  return {
    tiers: tiers.map(toBedrockTier),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
    })),
  };
}

function decodeQuota(value: unknown): BedrockModelQuota | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !isNullableNumber(value.tokens_per_minute) || !isNullableNumber(value.requests_per_minute)) {
    return undefined;
  }
  const { complete } = value;
  if (!(complete === undefined || typeof complete === 'boolean')) return undefined;
  return {
    tokens_per_minute: value.tokens_per_minute,
    requests_per_minute: value.requests_per_minute,
    complete: complete ?? true,
  };
}

function decodePassedTest(payload: Record<string, unknown>, model: string): BedrockModelTest {
  const quota = decodeQuota(payload.quota);
  const {
    request_style: requestStyle, latency_ms: latencyMs
  } = payload;
  if (!isAllowedString(requestStyle, REQUEST_STYLES) || !isFiniteNumber(latencyMs) || quota === undefined) {
    throw new BedrockModelError('Bedrock API returned an invalid test result');
  }
  return {
    valid: true,
    model,
    request_style: requestStyle,
    latency_ms: latencyMs,
    quota,
  };
}

function decodeBedrockModelTest(payload: unknown): BedrockModelTest {
  if (!isRecord(payload) || typeof payload.valid !== 'boolean' || typeof payload.model !== 'string') {
    throw new BedrockModelError('Bedrock API returned an invalid test result');
  }
  if (payload.valid) return decodePassedTest(payload, payload.model);
  const {
    reason, error
  } = payload;
  if (!isAllowedString(reason, FAILURE_REASONS) || !(error === undefined || isNullableString(error))) {
    throw new BedrockModelError('Bedrock API returned an invalid test result');
  }
  return {
    valid: false,
    model: payload.model,
    reason,
    error: error ?? null,
  };
}

/** A save refusal's `details` (the reason the model failed its check), else its `error`. */
function saveRefusal(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.error !== 'string') return null;
  return typeof payload.details === 'string' ? payload.details : payload.error;
}

export async function fetchBedrockModels(signal?: AbortSignal): Promise<BedrockModelListing> {
  const payload = await apiGet<unknown>(`${BEDROCK_PATH}/models`, {
    signal,
    acceptedJsonStatuses: [502],
  });
  const refusal = refusalMessage(payload);
  if (refusal !== null) throw new BedrockModelError(refusal);
  return decodeBedrockModelListing(payload);
}

/** One live call to `model` for `tier`; always answers with a result unless the request itself is malformed. */
export async function testBedrockModel(tier: BedrockTierId, model: string): Promise<BedrockModelTest> {
  const payload = await apiPost<unknown>(`${BEDROCK_PATH}/validate`, {
    tier,
    model,
  }, { acceptedJsonStatuses: [400] });
  // A failed test also carries `error`; only a body without `valid` is a refusal.
  const refusal = isRecord(payload) && !('valid' in payload) ? refusalMessage(payload) : null;
  if (refusal !== null) throw new BedrockModelError(refusal);
  return decodeBedrockModelTest(payload);
}

/** Store `model` for `tier` (the server tests it first); `null` returns the tier to its default model. */
export async function saveBedrockModel(tier: BedrockTierId, model: string | null): Promise<BedrockTier> {
  const payload = await apiPut<unknown>(BEDROCK_PATH, {
    tier,
    model,
    validate: true,
  }, { acceptedJsonStatuses: [400] });
  const refusal = saveRefusal(payload);
  if (refusal !== null) throw new BedrockModelError(refusal);
  if (!isBedrockTier(payload)) throw new BedrockModelError('Bedrock API returned an invalid tier');
  return toBedrockTier(payload);
}
