import {
  buildAlertItem, buildAlertSettings
} from '../types/domain/alerts-fixtures';
import {
  acknowledgeAlert, updateAlertSettings
} from './alertsApiMock-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import {
  ALERT_SETTINGS_UPDATE,
  beginHookRequest,
  buildAlertAcknowledgement,
  deferNextCall,
  renderLoadedAlertSettings,
  renderLoadedOpenAlerts,
} from './useAlerts-fixtures';

/** An alert action left pending in a mounted hook, with hand-settled responses. */
interface StartedAlertAction {
  pending: Promise<unknown>;
  unmount: () => void;
  succeed: () => void;
  fail: () => void;
}

async function startAcknowledgement(): Promise<StartedAlertAction> {
  const response = deferNextCall(acknowledgeAlert);
  const {
    result, unmount
  } = await renderLoadedOpenAlerts();
  const alertId = buildAlertItem().id;
  return {
    pending: beginHookRequest(() => result.current.acknowledge(alertId)),
    unmount,
    succeed: () => response.resolve(buildAlertAcknowledgement(alertId)),
    fail: () => response.reject(new AlertHookFailure()),
  };
}

async function startSettingsSave(): Promise<StartedAlertAction> {
  const response = deferNextCall(updateAlertSettings);
  const {
    result, unmount
  } = await renderLoadedAlertSettings();
  return {
    pending: beginHookRequest(() => result.current.saveSettings(ALERT_SETTINGS_UPDATE)),
    unmount,
    succeed: () => response.resolve(buildAlertSettings(ALERT_SETTINGS_UPDATE)),
    fail: () => response.reject(new AlertHookFailure()),
  };
}

const UNMOUNT_ACTIONS = [
  {
    action: 'acknowledgement',
    start: startAcknowledgement,
    cancellation: {
      success: false,
      message: 'Alert acknowledgement cancelled.',
    },
  },
  {
    action: 'save',
    start: startSettingsSave,
    cancellation: {
      success: false,
      message: 'Alert settings save cancelled.',
      warnings: [],
    },
  },
];

const SETTLEMENTS = [
  {
    condition: 'success',
    settle: (started: StartedAlertAction) => started.succeed(),
  },
  {
    condition: 'failure',
    settle: (started: StartedAlertAction) => started.fail(),
  },
];

/** Every alert action crossed with every way its response can settle after unmount. */
export const UNMOUNT_SETTLEMENT_CASES = UNMOUNT_ACTIONS.flatMap((action) => SETTLEMENTS.map((settlement) => ({
  ...action,
  ...settlement,
})));
