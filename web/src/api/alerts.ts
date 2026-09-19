import {
  apiGet, apiPost, apiPut
} from './client';
import type {
  AlertAcknowledgement,
  AlertSettings,
  AlertSettingsUpdate,
  AlertTestNotificationResponse,
  AlertsResponse,
  AlertStatusFilter,
  ContentChangeMarker,
  ContentChangesResponse,
  CreateContentChangeRequest,
} from '../types';
import {
  isAlertAcknowledgement,
  isAlertSettings,
  isAlertTestNotificationResponse,
  isAlertsResponse,
  isContentChangeMarker,
  isContentChangesResponse,
} from '../types/domain/alerts';

export class InvalidAlertResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAlertResponseError';
  }
}

export class InvalidAlertRequestError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAlertRequestError';
  }
}

interface FetchAlertsOptions {
  status: AlertStatusFilter;
  limit: number;
  signal?: AbortSignal;
}

interface FetchContentChangesOptions {
  groupId: string;
  limit: number;
  signal?: AbortSignal;
}

function requirePositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InvalidAlertRequestError('Alert request limit must be a positive integer');
  }
}

function decodeResponse<TResponse>(
  payload: unknown,
  decoder: (candidate: unknown) => candidate is TResponse,
  message: string
): TResponse {
  if (!decoder(payload)) throw new InvalidAlertResponseError(message);
  return payload;
}

export async function fetchAlerts({
  status, limit, signal
}: FetchAlertsOptions): Promise<AlertsResponse> {
  requirePositiveLimit(limit);
  const payload = await apiGet<unknown>('/alerts', {
    params: {
      status,
      limit: String(limit),
    },
    signal,
  });
  return decodeResponse(payload, isAlertsResponse, 'Alerts API returned an invalid list');
}

export async function acknowledgeAlert(id: string): Promise<AlertAcknowledgement> {
  const payload = await apiPost<unknown>(
    `/alerts/${encodeURIComponent(id)}/acknowledge`,
    {},
    { allowStructured4xx: true }
  );
  const acknowledgement = decodeResponse(
    payload,
    isAlertAcknowledgement,
    'Alerts API returned an invalid acknowledgement'
  );
  if (acknowledgement.id !== id) {
    throw new InvalidAlertResponseError('Alerts API acknowledged a different alert');
  }
  return acknowledgement;
}

export async function fetchAlertSettings(signal?: AbortSignal): Promise<AlertSettings> {
  const payload = await apiGet<unknown>('/alerts/settings', { signal });
  return decodeResponse(payload, isAlertSettings, 'Alerts API returned invalid settings');
}

export async function updateAlertSettings(settings: AlertSettingsUpdate): Promise<AlertSettings> {
  const payload = await apiPut<unknown>(
    '/alerts/settings',
    settings,
    { allowStructured4xx: true }
  );
  return decodeResponse(payload, isAlertSettings, 'Alerts API returned invalid settings');
}

export async function sendTestNotification(
  signal?: AbortSignal
): Promise<AlertTestNotificationResponse> {
  const payload = await apiPost<unknown>(
    '/alerts/test-notification',
    {},
    {
      allowStructured4xx: true,
      signal,
    }
  );
  return decodeResponse(
    payload,
    isAlertTestNotificationResponse,
    'Alerts API returned an invalid test-notification response'
  );
}

export async function fetchContentChanges({
  groupId, limit, signal
}: FetchContentChangesOptions): Promise<ContentChangesResponse> {
  requirePositiveLimit(limit);
  const payload = await apiGet<unknown>('/alerts/content-changes', {
    params: {
      group_id: groupId,
      limit: String(limit),
    },
    signal,
  });
  return decodeResponse(
    payload,
    isContentChangesResponse,
    'Alerts API returned an invalid content-change list'
  );
}

export async function createContentChange(
  request: CreateContentChangeRequest
): Promise<ContentChangeMarker> {
  const payload = await apiPost<unknown>(
    '/alerts/content-changes',
    request,
    { allowStructured4xx: true }
  );
  return decodeResponse(
    payload,
    isContentChangeMarker,
    'Alerts API returned an invalid content-change marker'
  );
}
