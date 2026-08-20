import { vi } from 'vitest';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import type { ProvidersConfigProps } from './ProvidersConfig';

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
