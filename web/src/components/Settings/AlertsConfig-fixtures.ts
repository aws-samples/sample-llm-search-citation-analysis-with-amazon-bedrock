import { createElement } from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
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
import { AlertsConfig } from './AlertsConfig';
import {
  useAlertSettings as alertSettingsHook,
  useContentChanges as contentChangesHook,
  useKeywordGroups as keywordGroupsHook,
} from './AlertsConfigHookMocks-fixtures';

export const ACCEPTED_TEST_OUTCOME = {
  success: true,
  message: 'Test notification accepted for delivery.',
};

export const sendTestNotificationMock = vi.fn().mockResolvedValue(ACCEPTED_TEST_OUTCOME);

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
    sendTestNotification: sendTestNotificationMock,
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

/** Points every hook AlertsConfig reads at its default fixture result. */
export function mockAlertsConfigHooks(): void {
  alertSettingsHook.mockReturnValue(buildAlertsConfigSettingsHookResult());
  contentChangesHook.mockReturnValue(buildAlertsConfigContentHookResult());
  keywordGroupsHook.mockReturnValue(buildAlertsConfigGroupsHookResult());
}

/**
 * Renders AlertsConfig with the settings hook result built from `settingsOverrides`.
 * Specs using it must mock `useAlerts` and `useKeywordGroups` with
 * `./AlertsConfigHookMocks-fixtures`.
 */
export function renderAlertsConfig(
  settingsOverrides: Partial<ReturnType<typeof useAlertSettings>> = {},
  isAdmin = true
): void {
  alertSettingsHook.mockReturnValue(buildAlertsConfigSettingsHookResult(settingsOverrides));
  render(createElement(AlertsConfig, { isAdmin }));
}
