import type { useIsAdmin } from '../../hooks/useIsAdmin';
import type { useOpenAlerts } from '../../hooks/useAlerts';
import { buildOpenAlertsHookResult } from '../../hooks/useAlerts-fixtures';
import { buildAlertItem } from '../../types/domain/alerts-fixtures';

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

/**
 * `count` open alerts, alert `n` raised by the run of 1 October 2026 at `n`:00,
 * listed oldest first so the panel's own newest-first ordering is what a spec sees.
 */
export function buildOpenAlertsOfRuns(count: number): ReturnType<typeof useOpenAlerts> {
  const items = Array.from({ length: count }, (_unused, index) => buildAlertItem({
    id: `alert-${index}`,
    message: `Alert of run ${index}.`,
    run_timestamp: `2026-10-01T${String(index).padStart(2, '0')}:00:00Z`,
  }));
  return buildOpenAlertsHookResult({
    items,
    count,
  });
}
