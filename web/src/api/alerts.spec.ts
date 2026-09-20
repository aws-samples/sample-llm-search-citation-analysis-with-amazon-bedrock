import {
  describe, expect, it, vi
} from 'vitest';
import {
  acknowledgeAlert,
  createContentChange,
  fetchAlerts,
  fetchAlertSettings,
  fetchContentChanges,
  InvalidAlertRequestError,
  InvalidAlertResponseError,
  sendTestNotification,
  updateAlertSettings,
} from './alerts';
import type { AlertAcknowledgement } from '../types';
import {
  PUBLIC_DEFAULT_ALERT_SETTINGS,
  buildAlertSettings,
  buildAlertTestNotificationResponse,
  buildAlertsResponse,
  buildContentChangeMarker,
  buildContentChangesResponse,
} from '../types/domain/alerts-fixtures';
import {
  mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('alerts API', () => {
  describe('error identity', () => {
    it('names malformed server payload failures as InvalidAlertResponseError', () => {
      expect(new InvalidAlertResponseError('Malformed payload').name).toBe(
        'InvalidAlertResponseError'
      );
    });

    it('names invalid client input failures as InvalidAlertRequestError', () => {
      expect(new InvalidAlertRequestError('Invalid input').name).toBe(
        'InvalidAlertRequestError'
      );
    });
  });

  describe('fetchAlerts', () => {
    it('returns decoded alerts and sends the status, limit, and signal', async () => {
      const response = buildAlertsResponse();
      const controller = new AbortController();
      mockApiGet.mockResolvedValue(response);

      const received = await fetchAlerts({
        status: 'open',
        limit: 20,
        signal: controller.signal,
      });

      expect(received).toStrictEqual(response);
      expect(mockApiGet).toHaveBeenCalledWith('/alerts', {
        params: {
          status: 'open',
          limit: '20',
        },
        signal: controller.signal,
      });
    });

    it('accepts one as the minimum alert request limit', async () => {
      const response = buildAlertsResponse();
      mockApiGet.mockResolvedValue(response);

      const received = await fetchAlerts({
        status: 'all',
        limit: 1
      });

      expect(received).toStrictEqual(response);
      expect(mockApiGet).toHaveBeenCalledWith('/alerts', {
        params: {
          status: 'all',
          limit: '1',
        },
        signal: undefined,
      });
    });

    it('throws InvalidAlertResponseError when the alert list is malformed', async () => {
      mockApiGet.mockResolvedValue({
        items: [{ id: 'incomplete' }],
        count: 1,
      });

      await expect(fetchAlerts({
        status: 'all',
        limit: 10,
      })).rejects.toThrow(InvalidAlertResponseError);
      await expect(fetchAlerts({
        status: 'all',
        limit: 10,
      })).rejects.toThrow('Alerts API returned an invalid list');
    });

    it('throws InvalidAlertRequestError when the limit is not positive', async () => {
      await expect(fetchAlerts({
        status: 'open',
        limit: 0,
      })).rejects.toThrow(InvalidAlertRequestError);
      await expect(fetchAlerts({
        status: 'open',
        limit: 0,
      })).rejects.toThrow('Alert request limit must be a positive integer');
    });
  });

  describe('acknowledgeAlert', () => {
    it('posts to the encoded alert id and returns acknowledged status', async () => {
      const response = {
        success: true,
        id: 'alert/with space',
        status: 'acknowledged',
      } satisfies AlertAcknowledgement;
      mockApiPost.mockResolvedValue(response);

      const received = await acknowledgeAlert('alert/with space');

      expect(received).toStrictEqual(response);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/alerts/alert%2Fwith%20space/acknowledge',
        {},
        { allowStructured4xx: true }
      );
    });

    it('throws the acknowledgement decoder failure when the payload is malformed', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        id: 'alert-1',
        status: 'open'
      });

      await expect(acknowledgeAlert('alert-1')).rejects.toThrow(InvalidAlertResponseError);
      await expect(acknowledgeAlert('alert-1')).rejects.toThrow(
        'Alerts API returned an invalid acknowledgement'
      );
    });

    it('rejects an acknowledgement for a different alert id', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        id: 'alert-2',
        status: 'acknowledged',
      });

      await expect(acknowledgeAlert('alert-1')).rejects.toThrow('Alerts API acknowledged a different alert');
    });
  });

  describe('alert settings', () => {
    it('gets and decodes the exact public default settings', async () => {
      const response = PUBLIC_DEFAULT_ALERT_SETTINGS;
      const controller = new AbortController();
      mockApiGet.mockResolvedValue(response);

      const received = await fetchAlertSettings(controller.signal);

      expect(received).toStrictEqual(response);
      expect(mockApiGet).toHaveBeenCalledWith('/alerts/settings', { signal: controller.signal });
    });

    it('throws the settings decoder failure when the GET payload is malformed', async () => {
      mockApiGet.mockResolvedValue({ config_id: 'default' });

      await expect(fetchAlertSettings()).rejects.toThrow(InvalidAlertResponseError);
      await expect(fetchAlertSettings()).rejects.toThrow(
        'Alerts API returned invalid settings'
      );
    });

    it('puts the complete editable settings object and returns server state', async () => {
      const update = {
        enabled: false,
        notification_emails: ['owner@example.com'],
        thresholds: {
          citation_rate_drop: 12.5,
          position_loss: 2.25,
          competitor_top_n: 10,
          improvement_after_content_change: 9.5,
        },
      };
      const response = buildAlertSettings({
        ...update,
        warnings: ['owner@example.com must confirm the subscription.'],
      });
      mockApiPut.mockResolvedValue(response);

      const received = await updateAlertSettings(update);

      expect(received).toStrictEqual(response);
      expect(mockApiPut).toHaveBeenCalledWith(
        '/alerts/settings',
        update,
        { allowStructured4xx: true }
      );
    });

    it('throws the settings decoder failure when the PUT payload is malformed', async () => {
      const settings = buildAlertSettings();
      mockApiPut.mockResolvedValue({ config_id: 'default' });

      await expect(updateAlertSettings({
        enabled: settings.enabled,
        notification_emails: settings.notification_emails,
        thresholds: settings.thresholds,
      })).rejects.toThrow(InvalidAlertResponseError);
      await expect(updateAlertSettings({
        enabled: settings.enabled,
        notification_emails: settings.notification_emails,
        thresholds: settings.thresholds,
      })).rejects.toThrow('Alerts API returned invalid settings');
    });

    it('posts an empty object when requesting a test notification', async () => {
      const response = buildAlertTestNotificationResponse();
      const controller = new AbortController();
      mockApiPost.mockResolvedValue(response);

      const received = await sendTestNotification(controller.signal);

      expect(received).toStrictEqual(response);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/alerts/test-notification',
        {},
        {
          allowStructured4xx: true,
          signal: controller.signal,
        }
      );
    });

    it('throws InvalidAlertResponseError when the test response is malformed', async () => {
      mockApiPost.mockResolvedValue({
        success: true,
        message: 'Unexpected response',
      });

      await expect(sendTestNotification()).rejects.toThrow(InvalidAlertResponseError);
      await expect(sendTestNotification()).rejects.toThrow(
        'Alerts API returned an invalid test-notification response'
      );
    });
  });

  describe('content changes', () => {
    it('gets markers for a group with the requested limit', async () => {
      const response = buildContentChangesResponse();
      const controller = new AbortController();
      mockApiGet.mockResolvedValue(response);

      const received = await fetchContentChanges({
        groupId: 'group/north',
        limit: 5,
        signal: controller.signal,
      });

      expect(received).toStrictEqual(response);
      expect(mockApiGet).toHaveBeenCalledWith('/alerts/content-changes', {
        params: {
          group_id: 'group/north',
          limit: '5',
        },
        signal: controller.signal,
      });
    });

    it('throws InvalidAlertRequestError when the marker limit is zero', async () => {
      await expect(fetchContentChanges({
        groupId: 'group-north',
        limit: 0,
      })).rejects.toThrow(InvalidAlertRequestError);
      await expect(fetchContentChanges({
        groupId: 'group-north',
        limit: 0,
      })).rejects.toThrow('Alert request limit must be a positive integer');
    });

    it('throws the content-change list decoder failure when the payload is malformed', async () => {
      mockApiGet.mockResolvedValue({
        items: [{ id: 'incomplete' }],
        count: 1
      });

      await expect(fetchContentChanges({
        groupId: 'group-north',
        limit: 1,
      })).rejects.toThrow(InvalidAlertResponseError);
      await expect(fetchContentChanges({
        groupId: 'group-north',
        limit: 1,
      })).rejects.toThrow('Alerts API returned an invalid content-change list');
    });

    it('posts a marker request and returns the decoded marker', async () => {
      const request = {
        group_id: 'group-north',
        description: 'Published a revised comparison',
        url: 'https://example.com/comparison',
      };
      const response = buildContentChangeMarker({
        group_id: request.group_id,
        description: request.description,
        url: request.url,
      });
      mockApiPost.mockResolvedValue(response);

      const received = await createContentChange(request);

      expect(received).toStrictEqual(response);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/alerts/content-changes',
        request,
        { allowStructured4xx: true }
      );
    });

    it('throws the content-change marker decoder failure when the payload is malformed', async () => {
      mockApiPost.mockResolvedValue({ id: 'incomplete' });

      await expect(createContentChange({
        group_id: 'group-north',
        description: 'Published a revised comparison',
      })).rejects.toThrow(InvalidAlertResponseError);
      await expect(createContentChange({
        group_id: 'group-north',
        description: 'Published a revised comparison',
      })).rejects.toThrow('Alerts API returned an invalid content-change marker');
    });
  });
});
