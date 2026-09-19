import {
  expect, vi 
} from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import type { authenticatedFetch } from '../infrastructure/auth';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  useProviderConfig, type ProviderConfig 
} from './useProviderConfig';

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

interface ProviderConfigMockFetchOptions {
  providers?: ProviderConfig[];
  shouldFail?: boolean;
  updateSuccess?: boolean;
  validationResult?: {
    valid: boolean;
    error?: string 
  };
}

function createMockFetch(options: ProviderConfigMockFetchOptions = {}) {
  return vi.fn<typeof authenticatedFetch>().mockImplementation((url, init) => {
    if (options.shouldFail) {
      return Promise.resolve(createMockJsonResponse({ error: 'Server error' }, 500));
    }

    if (url.includes('/providers/') && url.includes('/validate')) {
      return Promise.resolve(createMockJsonResponse(options.validationResult ?? { valid: true }));
    }

    if (url.includes('/providers/') && init?.method === 'PUT') {
      if (options.updateSuccess === false) {
        return Promise.resolve(createMockJsonResponse({ error: 'Update failed' }, 400));
      }
      return Promise.resolve(createMockJsonResponse({ success: true }));
    }

    if (url.includes('/providers')) {
      return Promise.resolve(createMockJsonResponse({ providers: options.providers ?? mockProviders }));
    }

    return Promise.resolve(createMockJsonResponse({}));
  });
}

/**
 * Points the mocked network layer at `createMockFetch(options)`, renders the
 * hook and waits for the initial provider load to finish.
 */
export async function renderLoadedProviderConfig(options: ProviderConfigMockFetchOptions = {}) {
  mockAuthenticatedFetch.mockImplementation(createMockFetch(options));
  const rendered = renderHook(() => useProviderConfig());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}


export function countProviderListRequests(): number {
  return mockAuthenticatedFetch.mock.calls.filter(([url]) => url.endsWith('/providers')).length;
}
