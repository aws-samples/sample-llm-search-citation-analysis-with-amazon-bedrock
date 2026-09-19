import {
  describe, expect, it
} from 'vitest';
import {
  isAlertAcknowledgement,
  isAlertSettings,
  isAlertTestNotificationResponse,
  isAlertsResponse,
  isContentChangeMarker,
  isContentChangesResponse,
} from './alerts';
import {
  BACKEND_ALERT_WIRE_FIXTURE,
  PUBLIC_DEFAULT_ALERT_SETTINGS,
  buildAlertItem,
  buildAlertSettings,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangesResponse,
} from './alerts-fixtures';

describe('alert runtime decoders', () => {
  describe('isAlertsResponse', () => {
    it('accepts a complete alert list', () => {
      expect(isAlertsResponse(buildAlertsResponse())).toBe(true);
    });

    it('accepts the backend wire alert with Dynamo metadata', () => {
      expect(isAlertsResponse({
        items: [BACKEND_ALERT_WIRE_FIXTURE],
        count: 1,
      })).toBe(true);
    });

    it('accepts an improvement alert with the complete nested marker', () => {
      expect(isAlertsResponse({
        items: [buildAlertItem({
          type: 'improvement_after_content_change',
          content_change: buildContentChangeMarker(),
        })],
        count: 1,
      })).toBe(true);
    });

    it('accepts an alert without an optional entity', () => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ entity: undefined })],
        count: 1,
      })).toBe(true);
    });

    it.each([
      ['null', null],
      ['an array', []],
      ['a missing items array', { count: 0 }],
      ['a negative count', {
        items: [],
        count: -1,
      }],
      ['a count smaller than the returned items', {
        items: [buildAlertItem()],
        count: 0,
      }],
    ])('rejects the top level when it is %s', (_condition, candidate) => {
      expect(isAlertsResponse(candidate)).toBe(false);
    });

    it.each([
      ['id', {
        ...buildAlertItem(),
        id: 42,
      }],
      ['group id', {
        ...buildAlertItem(),
        group_id: '',
      }],
      ['group name', {
        ...buildAlertItem(),
        group_name: undefined,
      }],
      ['execution id', {
        ...buildAlertItem(),
        execution_id: '',
      }],
      ['created timestamp', {
        ...buildAlertItem(),
        created_at: 'not-a-date',
      }],
      ['run timestamp', {
        ...buildAlertItem(),
        run_timestamp: undefined,
      }],
      ['type', {
        ...buildAlertItem(),
        type: 'unexpected',
      }],
      ['severity', {
        ...buildAlertItem(),
        severity: 'urgent',
      }],
      ['status', {
        ...buildAlertItem(),
        status: 'closed',
      }],
      ['previous value', {
        ...buildAlertItem(),
        previous: undefined,
      }],
      ['current value', {
        ...buildAlertItem(),
        current: undefined,
      }],
      ['delta value', {
        ...buildAlertItem(),
        delta: { amount: 12 },
      }],
      ['threshold value', {
        ...buildAlertItem(),
        threshold: [10],
      }],
      ['message', {
        ...buildAlertItem(),
        message: '',
      }],
    ])('rejects an alert when its required %s is malformed', (_field, alertCandidate) => {
      expect(isAlertsResponse({
        items: [alertCandidate],
        count: 1,
      })).toBe(false);
    });

    it('rejects an alert when its optional entity is blank', () => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ entity: '   ' })],
        count: 1,
      })).toBe(false);
    });

    it('rejects an alert when its optional content change is malformed', () => {
      const alertCandidate = buildAlertItem({ content_change: buildContentChangeMarker({ url: 'ftp://example.com/page' }) });

      expect(isAlertsResponse({
        items: [alertCandidate],
        count: 1,
      })).toBe(false);
    });
  });

  describe('isAlertAcknowledgement', () => {
    it('accepts an acknowledged success response', () => {
      expect(isAlertAcknowledgement({
        success: true,
        id: 'alert-1',
        status: 'acknowledged',
      })).toBe(true);
    });

    it('rejects a response without acknowledged status', () => {
      expect(isAlertAcknowledgement({
        success: true,
        id: 'alert-1',
        status: 'open',
      })).toBe(false);
    });
  });

  describe('isAlertTestNotificationResponse', () => {
    it('accepts the exact delivery-accepted response', () => {
      expect(isAlertTestNotificationResponse(buildAlertTestNotificationResponse())).toBe(true);
    });

    it.each([
      ['success is false', {
        ...buildAlertTestNotificationResponse(),
        success: false,
      }],
      ['the message differs', {
        ...buildAlertTestNotificationResponse(),
        message: 'Notification sent.',
      }],
      ['the message is missing', { success: true }],
      ['an unknown field is present', {
        ...buildAlertTestNotificationResponse(),
        delivery_id: 'delivery-1',
      }],
      ['the payload is null', null],
    ])('rejects the response when %s', (_condition, candidate) => {
      expect(isAlertTestNotificationResponse(candidate)).toBe(false);
    });
  });

  describe('isAlertSettings', () => {
    it('accepts resolved settings with subscription status and warnings', () => {
      expect(isAlertSettings(buildAlertSettings({ warnings: ['Confirmation is pending.'] }))).toBe(true);
    });

    it('accepts the exact public default settings', () => {
      expect(isAlertSettings(PUBLIC_DEFAULT_ALERT_SETTINGS)).toBe(true);
    });

    it('accepts decimal scalar thresholds at inclusive bounds', () => {
      expect(isAlertSettings(buildAlertSettings({
        thresholds: {
          citation_rate_drop: 0.1,
          position_loss: 2.5,
          competitor_top_n: 10,
          improvement_after_content_change: 100,
        },
      }))).toBe(true);
    });

    it.each([
      ['config id', {
        ...buildAlertSettings(),
        config_id: 'other',
      }],
      ['enabled flag', {
        ...buildAlertSettings(),
        enabled: 'true',
      }],
      ['thresholds', {
        ...buildAlertSettings(),
        thresholds: { citation_rate_drop: 10 },
      }],
      ['notification email with multiple at signs', {
        ...buildAlertSettings(),
        notification_emails: ['a@@b.com'],
      }],
      ['subscription status', {
        ...buildAlertSettings(),
        subscription_statuses: [{
          email: 'alerts@example.com',
          status: 'waiting',
        }],
      }],
      ['subscription email', {
        ...buildAlertSettings(),
        subscription_statuses: [{
          email: '',
          status: 'confirmed',
        }],
      }],
      ['warnings', {
        ...buildAlertSettings(),
        warnings: [42],
      }],
    ])('rejects settings when %s is malformed', (_field, settingsCandidate) => {
      expect(isAlertSettings(settingsCandidate)).toBe(false);
    });

    it.each([
      ['citation_rate_drop', 0],
      ['citation_rate_drop', 100.1],
      ['citation_rate_drop', Number.NaN],
      ['position_loss', 0],
      ['position_loss', 100.1],
      ['position_loss', Number.POSITIVE_INFINITY],
      ['competitor_top_n', 0],
      ['competitor_top_n', 11],
      ['competitor_top_n', 1.5],
      ['improvement_after_content_change', 0],
      ['improvement_after_content_change', 100.1],
      ['improvement_after_content_change', Number.NEGATIVE_INFINITY],
    ])('rejects settings when the %s threshold is %s', (thresholdName, thresholdValue) => {
      const settings = buildAlertSettings();
      const candidate = {
        ...settings,
        thresholds: {
          ...settings.thresholds,
          [thresholdName]: thresholdValue,
        },
      };

      expect(isAlertSettings(candidate)).toBe(false);
    });
  });

  describe('content change decoders', () => {
    it('accepts a marker with an HTTPS URL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker())).toBe(true);
    });

    it('accepts a marker with a numeric TTL from creation', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ ttl: 1822384800 }))).toBe(true);
    });

    it('accepts a marker without an optional URL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ url: undefined }))).toBe(true);
    });

    it('rejects a marker with a non-HTTP URL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ url: 'mailto:alerts@example.com' }))).toBe(false);
    });

    it('rejects a marker without a positive integer TTL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ ttl: 0 }))).toBe(false);
    });

    it('accepts a complete content-change list', () => {
      expect(isContentChangesResponse(buildContentChangesResponse())).toBe(true);
    });
  });
});
