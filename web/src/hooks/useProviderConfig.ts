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

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  model: string;
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

function createDefaultProviders(): ProviderConfig[] {
  return [
    {
      id: PROVIDER.OPENAI,
      name: PROVIDER_NAMES[PROVIDER.OPENAI],
      description: PROVIDER_DESCRIPTIONS[PROVIDER.OPENAI],
      model: 'gpt-5.2',
      docs_url: PROVIDER_DOCS_URLS[PROVIDER.OPENAI],
      enabled: true,
      configured: false,
      masked_key: null,
      last_updated: null,
    },
    {
      id: PROVIDER.PERPLEXITY,
      name: PROVIDER_NAMES[PROVIDER.PERPLEXITY],
      description: PROVIDER_DESCRIPTIONS[PROVIDER.PERPLEXITY],
      model: 'sonar',
      docs_url: PROVIDER_DOCS_URLS[PROVIDER.PERPLEXITY],
      enabled: true,
      configured: false,
      masked_key: null,
      last_updated: null,
    },
    {
      id: PROVIDER.GEMINI,
      name: PROVIDER_NAMES[PROVIDER.GEMINI],
      description: PROVIDER_DESCRIPTIONS[PROVIDER.GEMINI],
      model: 'gemini-2.0-flash',
      docs_url: PROVIDER_DOCS_URLS[PROVIDER.GEMINI],
      enabled: true,
      configured: false,
      masked_key: null,
      last_updated: null,
    },
    {
      id: PROVIDER.CLAUDE,
      name: PROVIDER_NAMES[PROVIDER.CLAUDE],
      description: PROVIDER_DESCRIPTIONS[PROVIDER.CLAUDE],
      model: 'claude-sonnet-4-5',
      docs_url: PROVIDER_DOCS_URLS[PROVIDER.CLAUDE],
      enabled: true,
      configured: false,
      masked_key: null,
      last_updated: null,
    },
  ];
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
