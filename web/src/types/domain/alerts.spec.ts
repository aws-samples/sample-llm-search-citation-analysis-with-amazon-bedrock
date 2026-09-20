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
  isHttpUrl,
  isNotificationEmail,
} from './alerts';
import {
  BACKEND_ALERT_WIRE_FIXTURE,
  PUBLIC_DEFAULT_ALERT_SETTINGS,
  VALID_ALERT_SEVERITIES,
  VALID_ALERT_STATUSES,
  VALID_ALERT_TYPES,
  VALID_SUBSCRIPTION_STATUSES,
  buildAlertItem,
  buildAlertItemCandidate,
  buildAlertSettings,
  buildAlertSettingsCandidate,
  buildAlertSettingsWithThreshold,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangeMarkerCandidate,
  buildContentChangesResponse,
} from './alerts-fixtures';

describe('alert runtime decoders', () => {
  describe('isNotificationEmail', () => {
    it.each([
      'alerts@example.com',
      'owner+alerts@sub.example.co.uk',
    ])('accepts %s when the address has one local part and a dotted domain', (candidate) => {
      expect(isNotificationEmail(candidate)).toBe(true);
    });

    it.each([
      ['the local part is empty', '@example.com'],
      ['the address contains multiple at signs', 'a@@example.com'],
      ['the domain begins with a dot', 'alerts@.com'],
      ['the domain has no dot', 'alerts@example'],
      ['the address ends with a dot', 'alerts@example.'],
      ['the address contains internal whitespace', 'alert owner@example.com'],
      ['the address contains leading whitespace', ' alerts@example.com'],
      ['the address contains trailing whitespace', 'alerts@example.com '],
    ])('rejects an email when %s', (_condition, candidate) => {
      expect(isNotificationEmail(candidate)).toBe(false);
    });
  });

  describe('isHttpUrl', () => {
    it.each([
      'http://example.com/page',
      'https://example.com/page',
    ])('accepts %s when the URL uses an HTTP protocol', (candidate) => {
      expect(isHttpUrl(candidate)).toBe(true);
    });

    it.each([
      ['the protocol is not HTTP', 'ftp://example.com/page'],
      ['the value cannot be parsed as a URL', 'not a URL'],
    ])('rejects a URL when %s', (_condition, candidate) => {
      expect(isHttpUrl(candidate)).toBe(false);
    });
  });

  describe('isAlertsResponse', () => {
    it('accepts a complete alert list', () => {
      expect(isAlertsResponse(buildAlertsResponse())).toBe(true);
    });

    it('accepts an empty alert list when count is zero', () => {
      expect(isAlertsResponse({
        items: [],
        count: 0
      })).toBe(true);
    });

    it('accepts the backend wire alert with Dynamo metadata', () => {
      expect(isAlertsResponse({
        items: [BACKEND_ALERT_WIRE_FIXTURE],
        count: 1,
      })).toBe(true);
    });

    it.each(VALID_ALERT_TYPES)('accepts %s when the alert type is supported', (type) => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ type })],
        count: 1,
      })).toBe(true);
    });

    it.each(VALID_ALERT_SEVERITIES)('accepts %s when the alert severity is supported', (severity) => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ severity })],
        count: 1,
      })).toBe(true);
    });

    it.each(VALID_ALERT_STATUSES)('accepts %s when the alert status is supported', (status) => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ status })],
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
      ['an array carrying otherwise valid response properties', Object.assign([], buildAlertsResponse())],
      ['a missing items array', { count: 0 }],
      ['a negative count', {
        items: [],
        count: -1
      }],
      ['a fractional count', {
        items: [],
        count: 0.5
      }],
      ['a string count', {
        items: [],
        count: '0'
      }],
      ['a non-finite count', {
        items: [],
        count: Number.POSITIVE_INFINITY
      }],
      ['a count smaller than the returned items', {
        items: [buildAlertItem()],
        count: 0,
      }],
      ['a mixed valid and malformed alert list', {
        items: [buildAlertItem(), buildAlertItemCandidate({ id: '' })],
        count: 2,
      }],
    ])('rejects the top level when it is %s', (_condition, candidate) => {
      expect(isAlertsResponse(candidate)).toBe(false);
    });

    it.each([
      ['id', { id: 42 }],
      ['group id', { group_id: '' }],
      ['group name', { group_name: undefined }],
      ['execution id', { execution_id: '' }],
      ['created timestamp', { created_at: 'not-a-date' }],
      ['run timestamp', { run_timestamp: undefined }],
      ['type', { type: 'unexpected' }],
      ['severity', { severity: 'urgent' }],
      ['status', { status: 'closed' }],
      ['previous value', { previous: undefined }],
      ['current value', { current: undefined }],
      ['delta value', { delta: { amount: 12 } }],
      ['threshold value', { threshold: [10] }],
      ['message', { message: '' }],
    ])('rejects an alert when its required %s is malformed', (_field, overrides) => {
      expect(isAlertsResponse({
        items: [buildAlertItemCandidate(overrides)],
        count: 1,
      })).toBe(false);
    });

    it.each([
      ['null', null],
      ['boolean', true],
      ['string', '12.5'],
      ['finite number', 12.5],
    ])('accepts a %s metric value', (_kind, metricValue) => {
      expect(isAlertsResponse({
        items: [buildAlertItem({ previous: metricValue })],
        count: 1,
      })).toBe(true);
    });

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ])('rejects %s when an alert metric is not finite', (metricValue) => {
      expect(isAlertsResponse({
        items: [buildAlertItemCandidate({ previous: metricValue })],
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
      const marker = buildContentChangeMarkerCandidate({ url: 'ftp://example.com/page' });
      const alertCandidate = buildAlertItemCandidate({ content_change: marker });

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

    it.each([
      ['the payload is null', null],
      ['the payload is an array', []],
      ['an array carries acknowledgement properties', Object.assign([], {
        success: true,
        id: 'alert-1',
        status: 'acknowledged',
      })],
      ['success is false', {
        success: false,
        id: 'alert-1',
        status: 'acknowledged',
      }],
      ['the id is blank', {
        success: true,
        id: '',
        status: 'acknowledged',
      }],
      ['the id is not a string', {
        success: true,
        id: 1,
        status: 'acknowledged',
      }],
      ['status is not acknowledged', {
        success: true,
        id: 'alert-1',
        status: 'open',
      }],
    ])('rejects an acknowledgement when %s', (_condition, candidate) => {
      expect(isAlertAcknowledgement(candidate)).toBe(false);
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

    it('accepts competitor top N at the inclusive minimum', () => {
      expect(isAlertSettings(buildAlertSettings({
        thresholds: {
          ...buildAlertSettings().thresholds,
          competitor_top_n: 1,
        },
      }))).toBe(true);
    });

    it.each(VALID_SUBSCRIPTION_STATUSES)(
      'accepts %s when the subscription status is supported',
      (status) => {
        expect(isAlertSettings(buildAlertSettings({
          subscription_statuses: [{
            email: 'alerts@example.com',
            status,
          }],
        }))).toBe(true);
      }
    );

    it.each([
      ['config id', { config_id: 'other' }],
      ['enabled flag', { enabled: 'true' }],
      ['thresholds', { thresholds: { citation_rate_drop: 10 } }],
      ['notification email with multiple at signs', { notification_emails: ['a@@b.com'] }],
      ['mixed notification email types', { notification_emails: ['alerts@example.com', 42] }],
      ['subscription record', { subscription_statuses: [null] }],
      ['subscription status', {
        subscription_statuses: [{
          email: 'alerts@example.com',
          status: 'waiting',
        }],
      }],
      ['subscription email', {
        subscription_statuses: [{
          email: '',
          status: 'confirmed',
        }],
      }],
      ['subscription email type', {
        subscription_statuses: [{
          email: 42,
          status: 'confirmed',
        }],
      }],
      ['updated timestamp', { updated_at: 'not-a-date' }],
      ['warnings', { warnings: [42] }],
      ['mixed warning types', { warnings: ['Pending confirmation', 42] }],
    ])('rejects settings when %s is malformed', (_field, overrides) => {
      expect(isAlertSettings(buildAlertSettingsCandidate(overrides))).toBe(false);
    });

    it.each([
      ['citation_rate_drop', 0],
      ['citation_rate_drop', 100.1],
      ['citation_rate_drop', '10'],
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
      expect(isAlertSettings(buildAlertSettingsWithThreshold(
        thresholdName,
        thresholdValue
      ))).toBe(false);
    });
  });

  describe('isContentChangeMarker', () => {
    it('accepts a marker with an HTTPS URL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker())).toBe(true);
    });

    it('accepts a marker with a numeric TTL at the inclusive minimum', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ ttl: 1 }))).toBe(true);
    });

    it('accepts a marker with a string TTL at the inclusive minimum', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ ttl: '1' }))).toBe(true);
    });

    it('accepts a marker without an optional URL', () => {
      expect(isContentChangeMarker(buildContentChangeMarker({ url: undefined }))).toBe(true);
    });

    it.each([
      ['id is blank', { id: '' }],
      ['id is not a string', { id: 42 }],
      ['group id is blank', { group_id: '' }],
      ['group id is not a string', { group_id: 42 }],
      ['timestamp is invalid', { changed_at: 'not-a-date' }],
      ['description is blank', { description: '   ' }],
      ['description is not a string', { description: 42 }],
      ['URL is not a string', { url: 42 }],
      ['URL does not use HTTP', { url: 'mailto:alerts@example.com' }],
      ['TTL is zero', { ttl: 0 }],
      ['TTL is negative', { ttl: -1 }],
      ['TTL is fractional', { ttl: 1.5 }],
      ['TTL has a leading zero', { ttl: '01' }],
      ['TTL has trailing whitespace', { ttl: '1 ' }],
      ['TTL has trailing text', { ttl: '1x' }],
      ['TTL is not numeric', { ttl: 'one' }],
      ['TTL exceeds the safe integer range', { ttl: '9007199254740992' }],
    ])('rejects a marker when %s', (_condition, overrides) => {
      expect(isContentChangeMarker(buildContentChangeMarkerCandidate(overrides))).toBe(false);
    });
  });

  describe('isContentChangesResponse', () => {
    it('accepts a complete content-change list', () => {
      expect(isContentChangesResponse(buildContentChangesResponse())).toBe(true);
    });

    it('accepts an empty content-change list when count is zero', () => {
      expect(isContentChangesResponse({
        items: [],
        count: 0
      })).toBe(true);
    });

    it.each([
      ['the payload is null', null],
      ['the payload is an array', []],
      ['an array carries otherwise valid response properties', Object.assign([], buildContentChangesResponse())],
      ['items is missing', { count: 0 }],
      ['items is not an array', {
        items: {},
        count: 0
      }],
      ['items mixes valid and malformed markers', {
        items: [buildContentChangeMarker(), buildContentChangeMarkerCandidate({ id: '' })],
        count: 2,
      }],
      ['count is negative', {
        items: [],
        count: -1
      }],
      ['count is fractional', {
        items: [],
        count: 0.5
      }],
      ['count is a string', {
        items: [],
        count: '0'
      }],
      ['count is not finite', {
        items: [],
        count: Number.POSITIVE_INFINITY
      }],
      ['count is smaller than the item list', {
        items: [buildContentChangeMarker()],
        count: 0,
      }],
    ])('rejects a content-change list when %s', (_condition, candidate) => {
      expect(isContentChangesResponse(candidate)).toBe(false);
    });
  });
});
