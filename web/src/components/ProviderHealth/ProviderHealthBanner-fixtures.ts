import { vi } from 'vitest';
import type { ProviderConfig } from '../../hooks/useProviderConfig';

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

export function buildBannerProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...CLAUDE,
    ...overrides,
  };
}

/** Claude as production found it: out of credit and still nominally enabled. */
export function buildCreditExhaustedProvider(
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  return buildBannerProvider({
    last_error: 'Your credit balance is too low',
    last_error_at: '2026-08-19T11:00:00Z',
    last_error_category: 'insufficient_credit',
    consecutive_failures: 3,
    ...overrides,
  });
}

interface ProviderConfigHookResult {
  providers: ProviderConfig[];
  loading: boolean;
  error: string | null;
  refreshProviders: () => Promise<void>;
  updateProvider: () => Promise<boolean>;
  validateKey: () => Promise<{valid: boolean;}>;
}

export function buildProviderConfigHookResult(
  overrides: Partial<ProviderConfigHookResult> = {}
): ProviderConfigHookResult {
  return {
    providers: [],
    loading: false,
    error: null,
    refreshProviders: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateProvider: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    validateKey: vi.fn<() => Promise<{valid: boolean;}>>().mockResolvedValue({ valid: true }),
    ...overrides,
  };
}
