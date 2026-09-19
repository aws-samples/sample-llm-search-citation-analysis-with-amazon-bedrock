import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  acknowledgeAlert,
  createContentChange,
  fetchAlerts,
  fetchAlertSettings,
  fetchContentChanges,
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

export function useOpenAlerts(limit = DEFAULT_OPEN_ALERT_LIMIT) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acknowledgingIds, setAcknowledgingIds] = useState<string[]>([]);
  const {
    beginRequest, cancelRequest, isMounted
  } = useLatestRequest();

  const refresh = useCallback(async (): Promise<void> => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const response = await fetchAlerts({
        status: 'open',
        limit,
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setItems(response.items);
      setCount(response.count);
    } catch (fetchError) {
      if (isAbortError(fetchError) || !request.isCurrent()) return;
      console.error('[alerts] Error fetching open alerts:', fetchError);
      setError(getErrorMessage(fetchError, 'alerts'));
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [beginRequest, limit]);

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
  }, [cancelRequest, isMounted]);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<AlertSettingsSaveOutcome | null>(null);
  const {
    beginRequest, cancelRequest, isMounted
  } = useLatestRequest();

  const refresh = useCallback(async (): Promise<void> => {
    const request = beginRequest();
    setLoading(true);
    setError(null);
    setSaveOutcome(null);
    try {
      const response = await fetchAlertSettings(request.signal);
      if (!request.isCurrent()) return;
      setSettings(response);
    } catch (fetchError) {
      if (isAbortError(fetchError) || !request.isCurrent()) return;
      console.error('[alerts] Error fetching settings:', fetchError);
      setError(getErrorMessage(fetchError, 'alerts'));
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [beginRequest]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSettings = useCallback(async (
    update: AlertSettingsUpdate
  ): Promise<AlertSettingsSaveOutcome> => {
    cancelRequest();
    if (isMounted()) {
      setLoading(false);
      setSaving(true);
      setSaveOutcome(null);
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
  }, [cancelRequest, isMounted]);

  return {
    settings,
    loading,
    error,
    saving,
    saveOutcome,
    refresh,
    saveSettings,
  };
}

export function useContentChanges(groupId: string) {
  const [latestMarker, setLatestMarker] = useState<ContentChangeMarker | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordOutcome, setRecordOutcome] = useState<AlertMutationOutcome | null>(null);
  const selectedGroupRef = useRef(groupId);
  selectedGroupRef.current = groupId;
  const {
    beginRequest, cancelRequest, isMounted
  } = useLatestRequest();

  const refresh = useCallback(async (): Promise<void> => {
    if (groupId === '') {
      cancelRequest();
      setLatestMarker(null);
      setLoading(false);
      setError(null);
      setRecording(false);
      setRecordOutcome(null);
      return;
    }

    const request = beginRequest();
    setLatestMarker(null);
    setLoading(true);
    setError(null);
    setRecording(false);
    setRecordOutcome(null);
    try {
      const response = await fetchContentChanges({
        groupId,
        limit: LATEST_CONTENT_CHANGE_LIMIT,
        signal: request.signal,
      });
      if (!request.isCurrent()) return;
      setLatestMarker(response.items[0] ?? null);
    } catch (fetchError) {
      if (isAbortError(fetchError) || !request.isCurrent()) return;
      console.error('[alerts] Error fetching content changes:', fetchError);
      setError(getErrorMessage(fetchError, 'alerts'));
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [beginRequest, cancelRequest, groupId]);

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
  }, [cancelRequest, isMounted]);

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
