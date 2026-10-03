import {
  useCallback, useEffect, useState
} from 'react';
import {
  fetchCustomReports, type CustomReport
} from '../../../api/customReports';
import { useLatestRequest } from '../../../hooks/useLatestRequest';
import {
  getErrorMessage, isAbortError
} from '../../../infrastructure';

interface CustomReportsState {
  readonly reports: readonly CustomReport[];
  readonly loading: boolean;
  readonly error: string | null;
}

/** The saved custom reports, newest change first (`GET /custom-reports`). */
export function useCustomReports() {
  const { beginRequest } = useLatestRequest();
  const [state, setState] = useState<CustomReportsState>({
    reports: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async (): Promise<void> => {
    const request = beginRequest();
    setState((previous) => ({
      ...previous,
      loading: true,
    }));
    try {
      const reports = await fetchCustomReports(request.signal);
      if (!request.isCurrent()) return;
      setState({
        reports,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (isAbortError(error) || !request.isCurrent()) return;
      setState({
        reports: [],
        loading: false,
        error: getErrorMessage(error),
      });
    } finally {
      request.finish();
    }
  }, [beginRequest]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    ...state,
    reload,
  };
}
