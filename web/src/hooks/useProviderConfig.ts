import {
  useState, useEffect, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import { 
  PROVIDER,
  PROVIDER_NAMES, 
  PROVIDER_DESCRIPTIONS, 
  PROVIDER_DOCS_URLS
} from '../constants/providers';
import type { ProviderHealthRecord } from '../formatting/providerHealth';

/**
 * Extends `ProviderHealthRecord`, whose fields are all optional: they only
 * appear once a provider has succeeded or failed at least once since health
 * tracking shipped.
 */
export interface ProviderConfig extends ProviderHealthRecord {
  id: string;
  name: string;
  description: string;
  /** The model runs use now (the configured one, else the default). */
  model: string;
  /** LLM providers only: the model used when nothing is configured. */
  default_model?: string;
  /** Whether an administrator can change the model (OpenAI and Gemini). */
  model_configurable?: boolean;
  /** When the model was last changed or returned to the default. */
  model_updated_at?: string;
  docs_url: string;
  enabled: boolean;
  configured: boolean;
  masked_key: string | null;
  last_updated: string | null;
}

interface UseProviderConfigReturn {
  providers: ProviderConfig[];
  loading: boolean;
  error: string | null;
  refreshProviders: () => Promise<void>;
  updateProvider: (providerId: string, updates: {
    enabled?: boolean;
    api_key?: string;
  }) => Promise<boolean>;
  validateKey: (providerId: string, apiKey: string) => Promise<{
    valid: boolean;
    error?: string;
  }>;
}

class ProviderFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderFetchError';
  }
}

class ProviderUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUpdateError';
  }
}

interface ProvidersResponse {providers?: ProviderConfig[];}

interface ErrorResponse {error?: string;}

interface ValidationResponse {
  valid: boolean;
  error?: string;
}

function isProvidersResponse(data: unknown): data is ProvidersResponse {
  return typeof data === 'object' && data !== null;
}

function isErrorResponse(data: unknown): data is ErrorResponse {
  return typeof data === 'object' && data !== null;
}

function isValidationResponse(data: unknown): data is ValidationResponse {
  return typeof data === 'object' && data !== null && 'valid' in data;
}

/** Defaults shown when the providers API is unreachable: each answer engine with its default model, unconfigured. */
const FALLBACK_PROVIDER_MODELS = [
  [PROVIDER.OPENAI, 'gpt-5-mini'],
  [PROVIDER.PERPLEXITY, 'sonar'],
  [PROVIDER.GEMINI, 'gemini-3-flash-preview'],
  [PROVIDER.CLAUDE, 'claude-sonnet-4-5'],
] as const;

function createDefaultProviders(): ProviderConfig[] {
  return FALLBACK_PROVIDER_MODELS.map(([id, model]) => ({
    id,
    name: PROVIDER_NAMES[id],
    description: PROVIDER_DESCRIPTIONS[id],
    model,
    docs_url: PROVIDER_DOCS_URLS[id],
    enabled: true,
    configured: false,
    masked_key: null,
    last_updated: null,
  }));
}



export function useProviderConfig(): UseProviderConfigReturn {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authenticatedFetch(`${API_BASE_URL}/providers`);
      if (!response.ok) {
        throw new ProviderFetchError(`Failed to fetch providers: ${response.status}`);
      }
      const data: unknown = await response.json();
      if (isProvidersResponse(data)) {
        setProviders(data.providers ?? []);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'providers'));
      console.error('[providers] Error fetching providers:', err);
      setProviders(createDefaultProviders());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchProviders();
    return () => controller.abort();
  }, [fetchProviders]);

  const updateProvider = useCallback(async (
    providerId: string,
    updates: {
      enabled?: boolean;
      api_key?: string;
    }
  ): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/providers/${providerId}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json',},
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) {
        const data: unknown = await response.json();
        const errorMsg = isErrorResponse(data) 
          ? data.error ?? `Failed to update provider: ${response.status}` 
          : `Failed to update provider: ${response.status}`;
        throw new ProviderUpdateError(errorMsg);
      }
      
      await fetchProviders();
      return true;
    } catch (err) {
      setError(getErrorMessage(err, 'providers'));
      console.error('[providers] Error updating provider:', err);
      return false;
    }
  }, [fetchProviders]);

  const validateKey = useCallback(async (
    providerId: string,
    apiKey: string
  ): Promise<{
    valid: boolean;
    error?: string;
  }> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/providers/${providerId}/validate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json',},
        body: JSON.stringify({api_key: apiKey,}),
      });
      
      const data: unknown = await response.json();
      if (isValidationResponse(data)) {
        return data;
      }
      return {
        valid: false,
        error: 'Invalid response',
      };
    } catch (err) {
      console.error('[providers] Error validating key:', err);
      return {
        valid: false,
        error: getErrorMessage(err, 'providers'),
      };
    }
  }, []);

  return {
    providers,
    loading,
    error,
    refreshProviders: fetchProviders,
    updateProvider,
    validateKey,
  };
}
