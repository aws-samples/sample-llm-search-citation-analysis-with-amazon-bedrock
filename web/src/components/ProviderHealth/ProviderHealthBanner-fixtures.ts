import { vi } from 'vitest';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  buildCreditExhaustedProvider, buildProviderConfig 
} from '../Settings/ProvidersConfig-fixtures';

/** The banner reads the same provider rows the Settings panel does. */
export {
  buildProviderConfig as buildBannerProvider, buildCreditExhaustedProvider 
};

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
