import { vi } from 'vitest';
import type { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  useAlertSettings, useContentChanges
} from '../../hooks/useAlerts';
import {
  buildAlertSettingsHookResult, buildContentChangesHookResult
} from '../../hooks/useAlerts-fixtures';
import {
  buildKeywordGroup, buildKeywordGroupsHookResult
} from '../../hooks/useKeywordGroups-fixtures';
import { buildAlertSettings } from '../../types/domain/alerts-fixtures';

export const recordContentChangeMock = vi.fn().mockResolvedValue({
  success: true,
  message: 'Content change recorded.',
});

export function buildAlertsConfigSettingsHookResult(
  overrides: Partial<ReturnType<typeof useAlertSettings>> = {}
): ReturnType<typeof useAlertSettings> {
  return buildAlertSettingsHookResult({
    settings: buildAlertSettings({
      notification_emails: [
        'alerts@example.com',
        'ALERTS@example.com',
        'ops@example.com',
      ],
      subscription_statuses: [
        {
          email: 'alerts@example.com',
          status: 'confirmed',
        },
        {
          email: 'pending@example.com',
          status: 'pending_confirmation',
        },
        {
          email: 'disabled@example.com',
          status: 'not_subscribed',
        },
      ],
    }),
    ...overrides,
  });
}

export function buildAlertsConfigContentHookResult(
  overrides: Partial<ReturnType<typeof useContentChanges>> = {}
): ReturnType<typeof useContentChanges> {
  return buildContentChangesHookResult({
    recordContentChange: recordContentChangeMock,
    ...overrides,
  });
}

export function buildAlertsConfigGroupsHookResult(
  overrides: Partial<ReturnType<typeof useKeywordGroups>> = {}
): ReturnType<typeof useKeywordGroups> {
  return {
    ...buildKeywordGroupsHookResult([buildKeywordGroup({
      id: 'group-north',
      name: 'North Region',
    })]),
    ...overrides,
  };
}
