import {
  useState, useCallback, useRef 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import {
  deploymentChannel, eventField, type LiveEvent
} from '../infrastructure/liveEvents';
import type {
  AnalysisScope, Execution, ExecutionEvent, ExecutionStatus 
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import type { KeywordProgress } from '../formatting/executionProcessor';
import { useLiveRefresh } from './useLiveRefresh';

const RUNS_CHANNEL = deploymentChannel('runs');
const TERMINAL_STATUSES: readonly string[] = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'];

/** What one status read found: a terminal status, a status still running, or nothing (the read failed). */
type StatusRead = 'terminal' | 'running' | 'unread';

function isTerminalStatus(status: string | undefined): status is Exclude<ExecutionStatus, 'RUNNING'> {
  return status !== undefined && TERMINAL_STATUSES.includes(status);
}

/** The terminal status `event` announces for execution `arn` (its Step Functions status change), else `null`. */
function announcedEnd(event: LiveEvent, arn: string): ExecutionStatus | null {
  if (event.type !== 'execution.status' || eventField(event, 'executionArn') !== arn) return null;
  const status = eventField(event, 'status');
  return isTerminalStatus(status) ? status : null;
}

/**
 * Whether `event` on the runs channel may change execution `arn`: its own Step Functions status change, one of
 * its steps (`run.step.finished` names the execution by name), or a keyword finishing (which names no run; one
 * run is on screen at a time, and a read it did not need is cheap).
 */
export function concernsExecution(event: LiveEvent, arn: string): boolean {
  if (event.type === 'execution.status') return eventField(event, 'executionArn') === arn;
  if (event.type === 'run.step.finished') return eventField(event, 'execution_id') === arn.split(':').pop();
  return event.type === 'run.keyword.finished';
}

/** @internal Response from the execution status API */
interface ExecutionStatusResponse {
  execution?: {
    status: ExecutionStatus;
    start_date?: string;
    stop_date?: string;
  };
  events?: ExecutionEvent[];
  /** ProcessKeywords map-run counts; decoded by `decodeKeywordProgress`. */
  progress?: unknown;
}

/** @internal Response from the trigger analysis API */
interface TriggerAnalysisResponse {
  execution_arn: string;
  execution_name: string;
  keywords_count: number;
}

/** Result returned from triggerAnalysis */
interface TriggerResult {
  success: boolean;
  message: string;
}

function isExecutionStatusResponse(data: unknown): data is ExecutionStatusResponse {
  return typeof data === 'object' && data !== null;
}

function isTriggerAnalysisResponse(data: unknown): data is TriggerAnalysisResponse {
  return typeof data === 'object' && data !== null && 'execution_arn' in data;
}

function isTriggerErrorResponse(data: unknown): data is { error?: string } {
  return typeof data === 'object' && data !== null;
}

/** A non-negative integer count, sent as a number or a digit string; anything else is `null`. */
function toCount(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hasEveryCount(counts: Record<keyof KeywordProgress, number | null>): counts is KeywordProgress {
  return Object.values(counts).every(count => count !== null);
}

/**
 * The status response's keyword progress, or `null` when it is absent
 * (no map run yet, runs started before the Distributed Map) or malformed.
 * Progress is decoration: a bad block hides the counts, never the status.
 */
function decodeKeywordProgress(value: unknown): KeywordProgress | null {
  if (!isRecord(value)) return null;
  const counts = {
    keywords_total: toCount(value.keywords_total),
    keywords_succeeded: toCount(value.keywords_succeeded),
    keywords_failed: toCount(value.keywords_failed),
    keywords_running: toCount(value.keywords_running),
    keywords_pending: toCount(value.keywords_pending),
  };
  return hasEveryCount(counts) ? counts : null;
}

/**
 * Hook for monitoring Step Functions execution status.
 * Reads the status of a started analysis once, then, while it runs, again whenever the runs channel says it
 * (or one of its keywords or steps) changed, and once on every (re)connect (TENETS.md tenet 8).
 * 
 * @param onComplete - Optional callback invoked once when the execution reaches a terminal status
 * @returns Object containing:
 * - `execution` - Current execution status and events
 * - `triggerAnalysis` - Function to start a new analysis (optionally with specific keywords)
 * - `isRunning` - Whether an execution is currently running
 * 
 * @example
 * ```tsx
 * const { execution, triggerAnalysis, isRunning } = useExecutionPolling(() => {
 *   toast.success('Analysis complete!');
 * });
 * 
 * // Start analysis for all keywords
 * const result = await triggerAnalysis();
 * 
 * // Or for a keyword group / explicit keyword ids
 * const result = await triggerAnalysis({ mode: 'groups', group_ids: ['hotel-coruna'] });
 * ```
 */
export const useExecutionPolling = (onComplete?: () => void) => {
  const [execution, setExecution] = useState<Execution | null>(null);
  // The running execution the runs channel is watched for; `null` listens to nothing.
  const [watchedArn, setWatchedArn] = useState<string | null>(null);
  // The execution onComplete already fired for, so a late event or a second read never fires it again
  // (AUDIT-2026-08-19 2.16 fired it on every tick).
  const completedArn = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // The terminal status the runs channel announced for the watched execution. It is the last event about the run,
  // so when the read it triggers fails the view applies it instead of staying on RUNNING with nothing left to read.
  const announced = useRef<{
    arn: string;
    status: ExecutionStatus 
  } | null>(null);

  /** Stop watching `executionArn` and fire `onComplete` once for it. */
  const finish = useCallback((executionArn: string) => {
    setWatchedArn((watched) => (watched === executionArn ? null : watched));
    if (completedArn.current !== executionArn) {
      completedArn.current = executionArn;
      onCompleteRef.current?.();
    }
  }, []);

  /**
   * Fetch and apply the execution status: `terminal` when the execution reached a terminal state, after which
   * nothing more is read for it, and `unread` when the read failed.
   */
  const fetchExecutionStatus = useCallback(async (executionArn: string): Promise<StatusRead> => {
    try {
      const encodedArn = encodeURIComponent(executionArn);
      const response = await authenticatedFetch(`${API_BASE_URL}/executions/${encodedArn}`);

      if (!response.ok) {
        console.error('Failed to fetch execution status:', response.status);
        return 'unread';
      }

      const json: unknown = await response.json();
      if (!isExecutionStatusResponse(json) || !json.execution) return 'unread';
      const status = json.execution.status;
      setExecution(prev => ({
        arn: executionArn,
        name: prev?.name ?? '',
        status,
        events: json.events ?? [],
        start_date: json.execution?.start_date ?? new Date().toISOString(),
        stop_date: json.execution?.stop_date,
        progress: decodeKeywordProgress(json.progress),
      }));
      if (!TERMINAL_STATUSES.includes(status)) return 'running';
      finish(executionArn);
      return 'terminal';
    } catch (err) {
      console.error('Error fetching execution status:', err);
      return 'unread';
    }
  }, [finish]);

  useLiveRefresh(
    watchedArn === null ? null : RUNS_CHANNEL,
    async () => {
      if (watchedArn === null) return;
      const read = await fetchExecutionStatus(watchedArn);
      const end = announced.current;
      if (read !== 'unread' || end?.arn !== watchedArn) return;
      setExecution((prev) => (prev?.arn === end.arn ? {
        ...prev,
        status: end.status 
      } : prev));
      finish(end.arn);
    },
    (event) => {
      if (watchedArn === null || !concernsExecution(event, watchedArn)) return false;
      const status = announcedEnd(event, watchedArn);
      if (status !== null) announced.current = {
        arn: watchedArn,
        status 
      };
      return true;
    }
  );

  const triggerAnalysis = async (scope?: AnalysisScope): Promise<TriggerResult> => {
    try {
      // A scope (groups / keyword ids / explicit all) goes to the subset
      // endpoint, which resolves it server-side against the active keywords.
      // No scope means "everything", which the classic endpoint handles.
      const isScoped = scope !== undefined;
      const endpoint = isScoped
        ? `${API_BASE_URL}/trigger-keyword-analysis`
        : `${API_BASE_URL}/trigger-analysis`;
      
      const requestOptions: RequestInit = isScoped
        ? {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ scope }),
        }
        : { method: 'POST' };

      const response = await authenticatedFetch(endpoint, requestOptions);
      const triggerJson: unknown = await response.json();

      if (response.ok && isTriggerAnalysisResponse(triggerJson)) {
        const now = new Date().toISOString();
        const arn = triggerJson.execution_arn;
        const name = triggerJson.execution_name;
        
        setExecution({
          arn,
          name,
          status: 'RUNNING',
          start_date: now,
          events: [],
        });

        if (await fetchExecutionStatus(arn) !== 'terminal') setWatchedArn(arn);

        const keywordCount = triggerJson.keywords_count;
        return {
          success: true,
          message: `Analysis started with ${keywordCount} keyword${keywordCount > 1 ? 's' : ''}!` 
        };
      } else {
        const errorMessage = isTriggerErrorResponse(triggerJson) && triggerJson.error
          ? triggerJson.error
          : getErrorMessage(new ApiRequestError(`HTTP ${response.status}`, response.status), 'analysis');
        return {
          success: false,
          message: errorMessage 
        };
      }
    } catch (err) {
      console.error('[analysis] Error triggering analysis:', err);
      return {
        success: false,
        message: getErrorMessage(err, 'analysis') 
      };
    }
  };

  return {
    execution,
    triggerAnalysis,
    isRunning: execution?.status === 'RUNNING',
  };
};
