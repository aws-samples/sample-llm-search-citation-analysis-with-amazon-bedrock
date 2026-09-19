import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  acknowledgeAlert,
  createContentChange,
  fetchAlerts,
  fetchAlertSettings,
  fetchContentChanges,
  sendTestNotification as requestTestNotification,
  updateAlertSettings,
} from '../api/alerts';
import type {
  AlertItem,
  AlertSettings,
  AlertSettingsUpdate,
  ContentChangeMarker,
  CreateContentChangeRequest,
} from '../types';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';
import { useLatestRequest } from './useLatestRequest';

export interface AlertMutationOutcome {
  success: boolean;
  message: string;
}

export interface AlertSettingsSaveOutcome extends AlertMutationOutcome { warnings: string[]; }

const DEFAULT_OPEN_ALERT_LIMIT = 20;
const LATEST_CONTENT_CHANGE_LIMIT = 1;

interface LatestAlertLoadOptions {
  initialLoading: boolean;
  resourceLabel: string;
}

interface LatestAlertLoad<TResponse> {
  request: (signal: AbortSignal) => Promise<TResponse>;
  onLoaded: (response: TResponse) => void;
}

/**
 * Loading/error state for one alert resource, fed by the latest request only:
 * stale or aborted responses never touch state, and the current one clears
 * `loading` when it settles.
 */
function useLatestAlertLoad({
  initialLoading, resourceLabel
}: LatestAlertLoadOptions) {
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const {
    beginRequest, cancelRequest, isMounted
  } = useLatestRequest();

  const load = useCallback(async <TResponse>({
    request, onLoaded
  }: LatestAlertLoad<TResponse>): Promise<void> => {
    const latest = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const response = await request(latest.signal);
      if (!latest.isCurrent()) return;
      onLoaded(response);
    } catch (loadError) {
      if (isAbortError(loadError) || !latest.isCurrent()) return;
      console.error(`[alerts] Error fetching ${resourceLabel}:`, loadError);
      setError(getErrorMessage(loadError, 'alerts'));
    } finally {
      if (latest.isCurrent()) setLoading(false);
      latest.finish();
    }
  }, [beginRequest, resourceLabel]);

  return {
    loading,
    error,
    setLoading,
    setError,
    load,
    cancelRequest,
    isMounted,
  };
}

export function useOpenAlerts(limit = DEFAULT_OPEN_ALERT_LIMIT) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [count, setCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acknowledgingIds, setAcknowledgingIds] = useState<string[]>([]);
  const {
    loading, error, setLoading, load, cancelRequest, isMounted
  } = useLatestAlertLoad({
    initialLoading: true,
    resourceLabel: 'open alerts',
  });

  const refresh = useCallback(async (): Promise<void> => {
    setActionError(null);
    await load({
      request: (signal) => fetchAlerts({
        status: 'open',
        limit,
        signal,
      }),
      onLoaded: (response) => {
        setItems(response.items);
        setCount(response.count);
      },
    });
  }, [limit, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const acknowledge = useCallback(async (id: string): Promise<AlertMutationOutcome> => {
    if (!isMounted()) {
      return {
        success: false,
        message: 'Alert acknowledgement cancelled.',
      };
    }

    cancelRequest();
    setLoading(false);
    setActionError(null);
    setAcknowledgingIds((currentIds) => currentIds.includes(id) ? currentIds : [...currentIds, id]);
    try {
      await acknowledgeAlert(id);
      if (isMounted()) {
        setItems((currentItems) => currentItems.filter((alertItem) => alertItem.id !== id));
        setCount((currentCount) => Math.max(0, currentCount - 1));
      }
      return {
        success: true,
        message: 'Alert acknowledged.',
      };
    } catch (acknowledgementError) {
      const message = getErrorMessage(acknowledgementError, 'alerts');
      console.error('[alerts] Error acknowledging alert:', acknowledgementError);
      if (isMounted()) setActionError(message);
      return {
        success: false,
        message,
      };
    } finally {
      if (isMounted()) {
        setAcknowledgingIds((currentIds) => currentIds.filter((currentId) => currentId !== id));
      }
    }
  }, [cancelRequest, isMounted, setLoading]);

  return {
    items,
    count,
    loading,
    error,
    actionError,
    acknowledgingIds,
    refresh,
    acknowledge,
  };
}

export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<AlertSettingsSaveOutcome | null>(null);
  const [testing, setTesting] = useState(false);
  const [testOutcome, setTestOutcome] = useState<AlertMutationOutcome | null>(null);
  const {
    loading, error, setLoading, setError, load, cancelRequest, isMounted
  } = useLatestAlertLoad({
    initialLoading: true,
    resourceLabel: 'settings',
  });
  const {
    beginRequest: beginTestRequest,
    cancelRequest: cancelTestRequest,
  } = useLatestRequest();

  const refresh = useCallback(async (): Promise<void> => {
    cancelTestRequest();
    setTesting(false);
    setTestOutcome(null);
    setSaveOutcome(null);
    await load({
      request: fetchAlertSettings,
      onLoaded: setSettings,
    });
  }, [cancelTestRequest, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(async (
    update: AlertSettingsUpdate
  ): Promise<AlertSettingsSaveOutcome> => {
    cancelRequest();
    cancelTestRequest();
    if (isMounted()) {
      setLoading(false);
      setSaving(true);
      setTesting(false);
      setSaveOutcome(null);
      setTestOutcome(null);
    }
    try {
      const response = await updateAlertSettings(update);
      cancelRequest();
      const outcome: AlertSettingsSaveOutcome = {
        success: true,
        message: 'Alert settings saved.',
        warnings: response.warnings ?? [],
      };
      if (isMounted()) {
        setSettings(response);
        setError(null);
        setSaveOutcome(outcome);
      }
      return outcome;
    } catch (saveError) {
      const outcome: AlertSettingsSaveOutcome = {
        success: false,
        message: getErrorMessage(saveError, 'alerts'),
        warnings: [],
      };
      console.error('[alerts] Error saving settings:', saveError);
      if (isMounted()) setSaveOutcome(outcome);
      return outcome;
    } finally {
      if (isMounted()) setSaving(false);
    }
  }, [cancelRequest, cancelTestRequest, isMounted, setError, setLoading]);

  const sendTestNotification = useCallback(async (): Promise<AlertMutationOutcome> => {
    if (!isMounted()) {
      return {
        success: false,
        message: 'Test notification cancelled.',
      };
    }

    const latest = beginTestRequest();
    setTesting(true);
    setSaveOutcome(null);
    setTestOutcome(null);
    try {
      const response = await requestTestNotification(latest.signal);
      const outcome: AlertMutationOutcome = {
        success: true,
        message: response.message,
      };
      if (latest.isCurrent()) setTestOutcome(outcome);
      return outcome;
    } catch (testError) {
      const aborted = isAbortError(testError);
      const outcome: AlertMutationOutcome = {
        success: false,
        message: aborted
          ? 'Test notification cancelled.'
          : getErrorMessage(testError, 'alerts'),
      };
      if (!aborted && latest.isCurrent()) {
        console.error('[alerts] Error sending test notification:', testError);
        setTestOutcome(outcome);
      }
      return outcome;
    } finally {
      if (latest.isCurrent()) setTesting(false);
      latest.finish();
    }
  }, [beginTestRequest, isMounted]);

  return {
    settings,
    loading,
    error,
    saving,
    saveOutcome,
    testing,
    testOutcome,
    refresh,
    saveSettings,
    sendTestNotification,
  };
}

export function useContentChanges(groupId: string) {
  const [latestMarker, setLatestMarker] = useState<ContentChangeMarker | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordOutcome, setRecordOutcome] = useState<AlertMutationOutcome | null>(null);
  const selectedGroupRef = useRef(groupId);
  selectedGroupRef.current = groupId;
  const {
    loading, error, setLoading, setError, load, cancelRequest, isMounted
  } = useLatestAlertLoad({
    initialLoading: false,
    resourceLabel: 'content changes',
  });

  const refresh = useCallback(async (): Promise<void> => {
    setLatestMarker(null);
    setRecording(false);
    setRecordOutcome(null);
    if (groupId === '') {
      cancelRequest();
      setLoading(false);
      setError(null);
      return;
    }

    await load({
      request: (signal) => fetchContentChanges({
        groupId,
        limit: LATEST_CONTENT_CHANGE_LIMIT,
        signal,
      }),
      onLoaded: (response) => setLatestMarker(response.items[0] ?? null),
    });
  }, [cancelRequest, groupId, load, setError, setLoading]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recordContentChange = useCallback(async (
    contentChange: CreateContentChangeRequest
  ): Promise<AlertMutationOutcome> => {
    cancelRequest();
    if (isMounted()) {
      setLoading(false);
      setRecording(true);
      setError(null);
      setRecordOutcome(null);
    }
    try {
      const marker = await createContentChange(contentChange);
      const outcome: AlertMutationOutcome = {
        success: true,
        message: 'Content change recorded.',
      };
      if (isMounted() && selectedGroupRef.current === contentChange.group_id) {
        setLatestMarker(marker);
        setRecordOutcome(outcome);
      }
      return outcome;
    } catch (recordError) {
      const outcome: AlertMutationOutcome = {
        success: false,
        message: getErrorMessage(recordError, 'alerts'),
      };
      console.error('[alerts] Error recording content change:', recordError);
      if (isMounted() && selectedGroupRef.current === contentChange.group_id) {
        setRecordOutcome(outcome);
      }
      return outcome;
    } finally {
      if (isMounted() && selectedGroupRef.current === contentChange.group_id) {
        setRecording(false);
      }
    }
  }, [cancelRequest, isMounted, setError, setLoading]);

  return {
    latestMarker,
    loading,
    error,
    recording,
    recordOutcome,
    refresh,
    recordContentChange,
  };
}
