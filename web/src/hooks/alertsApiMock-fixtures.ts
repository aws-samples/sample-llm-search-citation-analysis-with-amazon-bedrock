import { vi } from 'vitest';
import type * as AlertsApi from '../api/alerts';
import {
  buildAlertItem,
  buildAlertSettings,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangesResponse,
} from '../types/domain/alerts-fixtures';

export const acknowledgeAlert = vi.fn<typeof AlertsApi.acknowledgeAlert>();
export const createContentChange = vi.fn<typeof AlertsApi.createContentChange>();
export const fetchAlerts = vi.fn<typeof AlertsApi.fetchAlerts>();
export const fetchAlertSettings = vi.fn<typeof AlertsApi.fetchAlertSettings>();
export const fetchContentChanges = vi.fn<typeof AlertsApi.fetchContentChanges>();
export const sendTestNotification = vi.fn<typeof AlertsApi.sendTestNotification>();
export const updateAlertSettings = vi.fn<typeof AlertsApi.updateAlertSettings>();

export function resetAlertsApiMocks(): void {
  fetchAlerts.mockReset().mockResolvedValue(buildAlertsResponse());
  acknowledgeAlert.mockReset().mockResolvedValue({
    success: true,
    id: buildAlertItem().id,
    status: 'acknowledged',
  });
  fetchAlertSettings.mockReset().mockResolvedValue(buildAlertSettings());
  updateAlertSettings.mockReset().mockResolvedValue(buildAlertSettings());
  sendTestNotification.mockReset().mockResolvedValue(buildAlertTestNotificationResponse());
  fetchContentChanges.mockReset().mockResolvedValue(buildContentChangesResponse());
  createContentChange.mockReset().mockResolvedValue(buildContentChangeMarker());
}

export function prepareAlertHookTest(): void {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  resetAlertsApiMocks();
}
