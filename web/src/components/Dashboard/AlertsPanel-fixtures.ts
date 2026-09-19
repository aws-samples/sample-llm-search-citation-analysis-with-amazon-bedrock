import type { useIsAdmin } from '../../hooks/useIsAdmin';
import type { useOpenAlerts } from '../../hooks/useAlerts';
import { buildOpenAlertsHookResult } from '../../hooks/useAlerts-fixtures';

export function buildAlertsPanelHookResult(
  overrides: Partial<ReturnType<typeof useOpenAlerts>> = {}
): ReturnType<typeof useOpenAlerts> {
  return buildOpenAlertsHookResult(overrides);
}

export function buildAlertsPanelMembership(
  overrides: Partial<ReturnType<typeof useIsAdmin>> = {}
): ReturnType<typeof useIsAdmin> {
  return {
    isAdmin: true,
    loading: false,
    ...overrides,
  };
}
