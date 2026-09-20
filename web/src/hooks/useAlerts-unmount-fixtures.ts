import type {
  AlertAcknowledgement, AlertSettings
} from '../types';
import { buildAlertSettings } from '../types/domain/alerts-fixtures';
import { AlertHookFailure } from './alertHookErrors-fixtures';
import type { DeferredValue } from './useAlerts-fixtures';
import {
  ALERT_SETTINGS_UPDATE, buildAlertAcknowledgement
} from './useAlerts-fixtures';

interface AcknowledgementSettlement {
  condition: string;
  settle: (response: DeferredValue<AlertAcknowledgement>, alertId: string) => void;
}

interface SettingsSettlement {
  condition: string;
  settle: (response: DeferredValue<AlertSettings>) => void;
}

export const ACKNOWLEDGEMENT_SETTLEMENTS = [
  {
    condition: 'success',
    settle: (response, alertId) => response.resolve(buildAlertAcknowledgement(alertId)),
  },
  {
    condition: 'failure',
    settle: (response) => response.reject(new AlertHookFailure()),
  },
] satisfies AcknowledgementSettlement[];

export const SETTINGS_SETTLEMENTS = [
  {
    condition: 'success',
    settle: (response) => response.resolve(buildAlertSettings(ALERT_SETTINGS_UPDATE)),
  },
  {
    condition: 'failure',
    settle: (response) => response.reject(new AlertHookFailure()),
  },
] satisfies SettingsSettlement[];
