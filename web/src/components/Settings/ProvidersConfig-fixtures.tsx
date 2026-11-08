import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  ProvidersConfig, type ProvidersConfigProps 
} from './ProvidersConfig';

/** Healthy Claude row: the baseline every health scenario deviates from. */
const CLAUDE: ProviderConfig = {
  id: 'claude',
  name: 'Claude',
  description: 'Claude with web search',
  model: 'claude-sonnet-4-5',
  docs_url: 'https://console.anthropic.com',
  enabled: true,
  configured: true,
  masked_key: 'sk-ant-...xyz',
  last_updated: '2026-08-01T00:00:00Z',
  last_success_at: '2026-08-19T10:00:00Z',
};

export function buildProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...CLAUDE,
    ...overrides,
  };
}

/** The Amazon Bedrock Web Search gateway: authenticated by IAM, so it stores no key. */
export function buildIamProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return buildProviderConfig({
    id: 'agentcore',
    name: 'Amazon Bedrock Web Search',
    description: 'Amazon-operated web index through an AgentCore Gateway (IAM, no API key)',
    model: 'web-search',
    model_configurable: false,
    docs_url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html',
    auth: 'iam',
    masked_key: null,
    last_updated: null,
    last_success_at: undefined,
    ...overrides,
  });
}

/** What the DataForSEO rows send before a login is stored: no model, no key, never run. */
const NO_SEO_LOGIN: Partial<ProviderConfig> = {
  model: '',
  model_configurable: false,
  docs_url: 'https://app.dataforseo.com/api-access',
  configured: false,
  masked_key: null,
  last_updated: null,
  last_success_at: undefined,
};

/** The DataForSEO credential (`type: 'seo'`): a login and a password, no model. */
export function buildDataForSeoProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return buildProviderConfig({
    ...NO_SEO_LOGIN,
    id: 'dataforseo',
    name: 'DataForSEO',
    description: 'Search volume, keyword difficulty and Google results pages',
    type: 'seo',
    credential_fields: ['login', 'password'],
    ...overrides,
  });
}

/** The Google AI Overviews engine, which uses the DataForSEO login and stores no key. */
export function buildAiOverviewProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return buildProviderConfig({
    ...NO_SEO_LOGIN,
    id: 'google_ai_overview',
    name: 'Google AI Overviews',
    description: 'The AI Overview on a Google results page (via DataForSEO)',
    type: 'llm',
    credential_from: 'dataforseo',
    enabled: false,
    ...overrides,
  });
}

/**
 * Claude as production found it on 2026-08-19: out of credit, still nominally
 * enabled, and failing every request since 10:00Z.
 */
export function buildCreditExhaustedProvider(
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  return buildProviderConfig({
    last_error: 'Your credit balance is too low',
    last_error_at: '2026-08-19T10:00:00Z',
    last_error_category: 'insufficient_credit',
    consecutive_failures: 3,
    ...overrides,
  });
}

export function buildProvidersConfigProps(
  overrides: Partial<ProvidersConfigProps> = {}
): ProvidersConfigProps {
  return {
    providers: [buildProviderConfig()],
    loading: false,
    onUpdate: vi.fn<ProvidersConfigProps['onUpdate']>().mockResolvedValue(true),
    onRefresh: vi.fn<ProvidersConfigProps['onRefresh']>().mockResolvedValue(undefined),
    isAdmin: true,
    ...overrides,
  };
}

/** Mounts the panel showing the given provider rows, loaded and as an admin unless overridden. */
export function renderProvidersConfig(
  providers: ProviderConfig[],
  overrides: Partial<ProvidersConfigProps> = {}
) {
  return render(<ProvidersConfig {...buildProvidersConfigProps({
    providers,
    ...overrides,
  })} />);
}
