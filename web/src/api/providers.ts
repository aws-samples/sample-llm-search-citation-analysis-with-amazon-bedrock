/**
 * Provider configuration API client functions.
 */
import {
  apiGet, apiPut, apiPost 
} from './client';

export interface ProviderConfig {
  provider_id: string;
  display_name: string;
  enabled: boolean;
  model?: string;
  description?: string;
}

interface ProvidersResponse {providers: ProviderConfig[];}

/**
 * Fetches all provider configurations.
 */
export async function fetchProviders(signal?: AbortSignal): Promise<ProviderConfig[]> {
  const response = await apiGet<ProvidersResponse>('/providers', { signal });
  return response.providers ?? [];
}

/**
 * Updates a provider's configuration.
 */
export function updateProvider(
  providerId: string,
  config: {
    enabled: boolean;
    model?: string 
  }
): Promise<ProviderConfig> {
  return apiPut<ProviderConfig>(`/providers/${providerId}`, config);
}

interface ValidateProviderResponse {
  valid: boolean;
  message?: string;
  model?: string;
}

/**
 * Validates a provider's API key.
 */
export function validateProvider(providerId: string): Promise<ValidateProviderResponse> {
  return apiPost<ValidateProviderResponse>(`/providers/${providerId}/validate`, {});
}
