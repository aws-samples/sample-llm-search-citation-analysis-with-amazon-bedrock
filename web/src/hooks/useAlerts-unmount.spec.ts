import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import type {
  AlertAcknowledgement, AlertSettings
} from '../types';
import { buildAlertItem } from '../types/domain/alerts-fixtures';
import {
  acknowledgeAlert as mockAcknowledgeAlert,
  prepareAlertHookTest,
  updateAlertSettings as mockUpdateAlertSettings,
} from './alertsApiMock-fixtures';
import {
  ACKNOWLEDGEMENT_SETTLEMENTS,
  SETTINGS_SETTLEMENTS,
} from './useAlerts-unmount-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  beginHookRequest,
  createDeferredValue,
  renderLoadedAlertSettings,
  renderLoadedOpenAlerts,
} from './useAlerts-fixtures';

vi.mock('../api/alerts', () => import('./alertsApiMock-fixtures'));

beforeEach(prepareAlertHookTest);

describe('alert actions settling after unmount', () => {
  it.each(ACKNOWLEDGEMENT_SETTLEMENTS)(
    'returns acknowledgement cancellation when $condition arrives after unmount',
    async ({ settle }) => {
      const response = createDeferredValue<AlertAcknowledgement>();
      mockAcknowledgeAlert.mockReturnValueOnce(response.promise);
      const {
        result, unmount
      } = await renderLoadedOpenAlerts();
      const alertId = buildAlertItem().id;
      const pending = beginHookRequest(() => result.current.acknowledge(alertId));

      unmount();
      settle(response, alertId);

      await expect(pending).resolves.toStrictEqual({
        success: false,
        message: 'Alert acknowledgement cancelled.',
      });
    }
  );

  it.each(SETTINGS_SETTLEMENTS)(
    'returns save cancellation when $condition arrives after unmount',
    async ({ settle }) => {
      const response = createDeferredValue<AlertSettings>();
      mockUpdateAlertSettings.mockReturnValueOnce(response.promise);
      const {
        result, unmount
      } = await renderLoadedAlertSettings();
      const pending = beginHookRequest(() => result.current.saveSettings(ALERT_SETTINGS_UPDATE));

      unmount();
      settle(response);

      await expect(pending).resolves.toStrictEqual({
        success: false,
        message: 'Alert settings save cancelled.',
        warnings: [],
      });
    }
  );
});
