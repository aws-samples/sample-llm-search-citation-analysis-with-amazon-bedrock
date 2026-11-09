import type { ProviderConfig } from '../../hooks/useProviderConfig';
import { mockProviders } from '../../hooks/useProviderConfig-fixtures';
import type { QueryPrompt } from '../../types';
import { createMockJsonResponse } from '../../test/fetchResponses';
import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { FAMILY_TRAVELER_PROMPT } from '../Settings/QueryPromptsManager-generic-fixtures';

/** A ready answer engine (enabled, with its key), overridable per test. */
export function buildEngine(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...mockProviders[0],
    type: 'llm',
    ...overrides,
  };
}

export const READY_ENGINES: ProviderConfig[] = [
  buildEngine(),
  buildEngine({
    id: 'perplexity',
    name: 'Perplexity',
  }),
  buildEngine({
    id: 'google_ai_overview',
    name: 'Google AI Overviews',
  }),
  // Neither switched off nor keyless engines, nor web-search providers, count.
  buildEngine({
    id: 'gemini',
    name: 'Google Gemini',
    enabled: false,
  }),
  buildEngine({
    id: 'claude',
    name: 'Anthropic Claude',
    configured: false,
  }),
  buildEngine({
    id: 'brave',
    name: 'Brave Search',
    type: 'search',
  }),
];

export function buildPersona(overrides: Partial<QueryPrompt> = {}): QueryPrompt {
  return {
    ...FAMILY_TRAVELER_PROMPT,
    ...overrides,
  };
}

export const TWO_PERSONAS: QueryPrompt[] = [
  buildPersona(),
  buildPersona({
    id: 'persona-2',
    name: 'Business traveler',
  }),
  buildPersona({
    id: 'persona-3',
    name: 'Paused persona',
    enabled: 'false',
  }),
];

/** Answers `GET /providers` and `GET /query-prompts`; a `null` provider list answers 500. */
export function answerRunTargets(providers: ProviderConfig[] | null = READY_ENGINES, prompts: QueryPrompt[] = TWO_PERSONAS): void {
  mockAuthenticatedFetch.mockImplementation((url) => {
    if (String(url).endsWith('/query-prompts')) return Promise.resolve(createMockJsonResponse(prompts));
    if (providers === null) return Promise.resolve(createMockJsonResponse({ error: 'down' }, 500));
    return Promise.resolve(createMockJsonResponse({ providers }));
  });
}
