import { vi } from 'vitest';
import {
  render, screen 
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderConfig } from '../../hooks/useProviderConfig';
import {
  buildCreditExhaustedProvider, buildProviderConfig 
} from '../Settings/ProvidersConfig-fixtures';
import { ProviderHealthBanner } from './ProviderHealthBanner';

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

/** Mounts the banner; the review link calls `onNavigateToProviders`. */
export function renderBanner(onNavigateToProviders = vi.fn()) {
  return render(<ProviderHealthBanner onNavigateToProviders={onNavigateToProviders} />);
}

export async function dismissBanner(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss provider warning' }));
}
