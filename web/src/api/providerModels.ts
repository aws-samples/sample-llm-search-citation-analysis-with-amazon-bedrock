/**
 * Provider model selection API client (Settings > AI Providers).
 *
 * OpenAI and Gemini answer with a model an administrator can change. The
 * server proves a model answers a web-search prompt before storing it, and
 * its refusal carries the provider's own reason in `details` (for example
 * "web_search_preview is not supported with gpt-3.5-turbo"), which is exactly
 * what the administrator needs to see — so 400 and 502 bodies are read here
 * instead of being flattened into a bare status by the shared client.
 */
import {
  apiGet, apiPut
} from './client';
import {
  isRecord, isStringArray
} from './contentStudioDecoderPrimitives';

export class ProviderModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderModelError';
  }
}

export interface ProviderModelListing {
  /** Ids the stored key can use, filtered to models that can answer a prompt. */
  models: string[];
  /** The model runs use now. */
  model: string;
  /** The model runs use when nothing is configured. */
  default_model: string;
}

/** `"error: details"` from a refusal body, or `null` when `payload` is not one. */
export function refusalMessage(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.error !== 'string') return null;
  return typeof payload.details === 'string' ? `${payload.error}: ${payload.details}` : payload.error;
}

function isProviderModelListing(payload: unknown): payload is ProviderModelListing {
  return isRecord(payload)
    && isStringArray(payload.models)
    && typeof payload.model === 'string'
    && typeof payload.default_model === 'string';
}

function providerPath(providerId: string): string {
  return `/providers/${encodeURIComponent(providerId)}`;
}

export async function fetchProviderModels(providerId: string, signal?: AbortSignal): Promise<ProviderModelListing> {
  const payload = await apiGet<unknown>(`${providerPath(providerId)}/models`, {
    signal,
    acceptedJsonStatuses: [400, 502],
  });
  const refusal = refusalMessage(payload);
  if (refusal !== null) throw new ProviderModelError(refusal);
  if (!isProviderModelListing(payload)) {
    throw new ProviderModelError('Provider API returned an invalid model list');
  }
  return payload;
}

/** Store `model` for `providerId`; `null` returns the provider to its default model. */
export async function saveProviderModel(providerId: string, model: string | null): Promise<void> {
  const payload = await apiPut<unknown>(providerPath(providerId), { model }, { acceptedJsonStatuses: [400] });
  const refusal = refusalMessage(payload);
  if (refusal !== null) throw new ProviderModelError(refusal);
}
