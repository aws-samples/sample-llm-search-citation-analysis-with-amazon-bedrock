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
  beginAlertAcknowledgement,
  beginSettingsSave,
  deferNextCall,
  rejectDeferredValue,
  renderLoadedAlertSettings,
  renderLoadedOpenAlerts,
  resolveAcknowledgement,
  resolveSavedSettings,
} from './useAlerts-fixtures';
import { deferNextTwoCalls } from '../test/fetchResponses';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('alert action settlement state', () => {
  it('removes only the failed acknowledgement id when another id is pending', async () => {
    const [failed, pending] = deferNextTwoCalls<AlertAcknowledgement>(mockAcknowledgeAlert);
    const { result } = await renderLoadedOpenAlerts();
    const failedRequest = beginAlertAcknowledgement(result.current, 'alert-failed');
    const pendingRequest = beginAlertAcknowledgement(result.current, 'alert-pending');

    await rejectDeferredValue(failed, new AlertHookFailure(), failedRequest);

    expect(result.current.acknowledgingIds).toStrictEqual(['alert-pending']);

    await resolveAcknowledgement(pending, 'alert-pending', pendingRequest);
  });

  it('clears saving when a pending save succeeds', async () => {
    const response = deferNextCall<AlertSettings>(mockUpdateAlertSettings);
    const { result } = await renderLoadedAlertSettings();

    const pending = beginSettingsSave(result.current);
    expect(result.current.saving).toBe(true);

    await resolveSavedSettings(response, pending);

    expect(result.current.saving).toBe(false);
  });
});
