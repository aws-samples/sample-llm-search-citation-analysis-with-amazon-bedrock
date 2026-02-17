import { vi } from 'vitest';
import type { ProviderConfig } from './useProviderConfig';

export const mockProviders: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4 with web search',
    model: 'gpt-5.2',
    docs_url: 'https://openai.com/docs',
    enabled: true,
    configured: true,
    masked_key: 'sk-...abc',
    last_updated: '2024-01-01T00:00:00Z',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Sonar model',
    model: 'sonar',
    docs_url: 'https://perplexity.ai/docs',
    enabled: false,
    configured: false,
    masked_key: null,
    last_updated: null,
  },
];

export function createMockFetch(options: {
  providers?: ProviderConfig[];
  shouldFail?: boolean;
  updateSuccess?: boolean;
  validationResult?: {
    valid: boolean;
    error?: string 
  };
} = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
    }

    if (url.includes('/providers/') && url.includes('/validate')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.validationResult ?? { valid: true }),
      });
    }

    if (url.includes('/providers/') && init?.method === 'PUT') {
      if (options.updateSuccess === false) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Update failed' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    }

    if (url.includes('/providers')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ providers: options.providers ?? mockProviders }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}
