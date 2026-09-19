import type {
  AlertItem,
  AlertSettings,
  AlertsResponse,
  ContentChangeMarker,
  ContentChangesResponse,
} from './alerts';

export function buildContentChangeMarker(
  overrides: Partial<ContentChangeMarker> = {}
): ContentChangeMarker {
  return {
    id: 'change-9a43216f26b0ec30a5155fa455915c49',
    group_id: 'group-1',
    changed_at: '2026-10-01T10:00:00Z',
    description: 'Updated the product comparison page',
    url: 'https://example.com/comparison',
    ttl: '1822384800',
    ...overrides,
  };
}

export const BACKEND_ALERT_WIRE_FIXTURE = {
  id: 'alert-d9c3a09f6c91aeb393b663030c383310',
  group_id: 'group-1',
  group_name: 'Group One',
  execution_id: 'exec-1',
  created_at: '2026-10-01T10:00:00Z',
  run_timestamp: '2026-10-01T10:00:00Z',
  status: 'open',
  acknowledged: false,
  ttl: '1822384800',
  type: 'citation_rate_drop',
  severity: 'warning',
  previous: '64.0',
  current: '52.0',
  delta: '12.0',
  threshold: '10.0',
  entity: 'group-1',
  message: 'Citation coverage fell by 12.0 percentage points.',
} satisfies AlertItem & {
  acknowledged: boolean;
  ttl: string;
};

export function buildAlertItem(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    ...BACKEND_ALERT_WIRE_FIXTURE,
    ...overrides,
  };
}

export function buildAlertsResponse(
  overrides: Partial<AlertsResponse> = {}
): AlertsResponse {
  return {
    items: [buildAlertItem()],
    count: 1,
    ...overrides,
  };
}

export const PUBLIC_DEFAULT_ALERT_SETTINGS = {
  config_id: 'default',
  enabled: true,
  notification_emails: [],
  thresholds: {
    citation_rate_drop: 10,
    position_loss: 1,
    competitor_top_n: 3,
    improvement_after_content_change: 5,
  },
  subscription_statuses: [],
} satisfies AlertSettings;

export function buildAlertSettings(overrides: Partial<AlertSettings> = {}): AlertSettings {
  return {
    config_id: 'default',
    enabled: true,
    notification_emails: ['alerts@example.com'],
    thresholds: {
      citation_rate_drop: 10,
      position_loss: 3,
      competitor_top_n: 5,
      improvement_after_content_change: 8,
    },
    updated_at: '2026-09-21T12:00:00Z',
    subscription_statuses: [{
      email: 'alerts@example.com',
      status: 'confirmed',
    }],
    ...overrides,
  };
}

export function buildContentChangesResponse(
  overrides: Partial<ContentChangesResponse> = {}
): ContentChangesResponse {
  return {
    items: [buildContentChangeMarker()],
    count: 1,
    ...overrides,
  };
}
