import type { ProviderHealthCandidate } from './providerHealth';

const HEALTHY_CLAUDE: ProviderHealthCandidate = {
  id: 'claude',
  name: 'Claude',
  enabled: true,
  configured: true,
  last_success_at: '2026-08-19T09:00:00Z',
};

/**
 * The production shape from AUDIT-2026-08-19: Anthropic rejecting every request
 * for insufficient credit.
 */
export const creditExhaustedRecord = {
  last_error: 'Your credit balance is too low',
  last_error_at: '2026-08-19T10:00:00Z',
  last_error_category: 'insufficient_credit',
  last_success_at: '2026-08-13T22:15:00Z',
  consecutive_failures: 3,
} as const;

export function buildProviderHealthCandidate(
  overrides: Partial<ProviderHealthCandidate> = {}
): ProviderHealthCandidate {
  return {
    ...HEALTHY_CLAUDE,
    ...overrides,
  };
}

/** A provider the backend switched off after repeated credit rejections. */
export function buildAutoDisabledCandidate(
  overrides: Partial<ProviderHealthCandidate> = {}
): ProviderHealthCandidate {
  return buildProviderHealthCandidate({
    ...creditExhaustedRecord,
    enabled: false,
    auto_disabled: true,
    disabled_reason: 'No credit remaining on this provider account',
    ...overrides,
  });
}
