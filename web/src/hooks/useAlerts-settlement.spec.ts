import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import type {
  AlertAcknowledgement, AlertSettings
} from '../types';
import {
  acknowledgeAlert as mockAcknowledgeAlert,
  prepareAlertHookTest,
  updateAlertSettings as mockUpdateAlertSettings,
} from './alertsApiMock-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  beginHookRequest,
  buildAlertAcknowledgement,
  createDeferredValue,
  rejectDeferredValue,
  renderLoadedAlertSettings,
  renderLoadedOpenAlerts,
  resolveDeferredValue,
  resolveSavedSettings,
} from './useAlerts-fixtures';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('alert action settlement state', () => {
  it('removes only the failed acknowledgement id when another id is pending', async () => {
    const failed = createDeferredValue<AlertAcknowledgement>();
    const pending = createDeferredValue<AlertAcknowledgement>();
    mockAcknowledgeAlert
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(pending.promise);
    const { result } = await renderLoadedOpenAlerts();
    const failedRequest = beginHookRequest(() => result.current.acknowledge('alert-failed'));
    const pendingRequest = beginHookRequest(() => result.current.acknowledge('alert-pending'));

    await rejectDeferredValue(failed, new AlertHookFailure(), failedRequest);

    expect(result.current.acknowledgingIds).toStrictEqual(['alert-pending']);

    await resolveDeferredValue(
      pending,
      buildAlertAcknowledgement('alert-pending'),
      pendingRequest
    );
  });

  it('clears saving when a pending save succeeds', async () => {
    const response = createDeferredValue<AlertSettings>();
    mockUpdateAlertSettings.mockReturnValueOnce(response.promise);
    const { result } = await renderLoadedAlertSettings();

    const pending = beginHookRequest(() => result.current.saveSettings(ALERT_SETTINGS_UPDATE));
    expect(result.current.saving).toBe(true);

    await resolveSavedSettings(response, pending);

    expect(result.current.saving).toBe(false);
  });
});
