import {
  useState, useEffect, useCallback 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type {
  Execution, ExecutionEvent, ExecutionStatus 
} from '../types';

/** @internal Response from the execution status API */
interface ExecutionStatusResponse {
  execution?: {
    status: ExecutionStatus;
    start_date?: string;
    stop_date?: string;
  };
  events?: ExecutionEvent[];
}

/** @internal Response from the trigger analysis API */
interface TriggerAnalysisResponse {
  execution_arn: string;
  execution_name: string;
  keywords_count: number;
  error?: string;
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

/**
 * Hook for monitoring Step Functions execution status.
 * Provides polling for real-time execution updates and analysis triggering.
 * 
 * @param onComplete - Optional callback invoked when execution completes
 * @returns Object containing:
 * - `execution` - Current execution status and events
 * - `triggerAnalysis` - Function to start a new analysis (optionally with specific keywords)
 * - `startMonitoring` - Function to start monitoring an existing execution
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
 * // Or for specific keywords
 * const result = await triggerAnalysis(['keyword1', 'keyword2']);
 * ```
 */
export const useExecutionPolling = (onComplete?: () => void) => {
  const [execution, setExecution] = useState<Execution | null>(null);
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [pollingInterval]);

  const fetchExecutionStatus = useCallback(async (executionArn: string) => {
    try {
      const encodedArn = encodeURIComponent(executionArn);
      const response = await authenticatedFetch(`${API_BASE_URL}/executions/${encodedArn}`);

      if (!response.ok) {
        console.error('Failed to fetch execution status:', response.status);
        return;
      }

      const json: unknown = await response.json();
      if (!isExecutionStatusResponse(json)) return;

      if (json.execution) {
        setExecution(prev => ({
          arn: executionArn,
          name: prev?.name ?? '',
          status: json.execution?.status ?? 'RUNNING',
          events: json.events ?? [],
          start_date: json.execution?.start_date ?? new Date().toISOString(),
          stop_date: json.execution?.stop_date,
        }));

        // Stop polling if execution is complete
        if (['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'ABORTED'].includes(json.execution.status)) {
          stopPolling();
          onComplete?.();
        }
      }
    } catch (err) {
      console.error('Error fetching execution status:', err);
    }
  }, [onComplete, stopPolling]);

  const startPolling = useCallback((executionArn: string) => {
    stopPolling();
    const interval = setInterval(() => {
      fetchExecutionStatus(executionArn);
    }, 3000);
    setPollingInterval(interval);
  }, [fetchExecutionStatus, stopPolling]);

  const triggerAnalysis = async (selectedKeywords?: string[]): Promise<TriggerResult> => {
    try {
      const isKeywordSpecific = selectedKeywords && selectedKeywords.length > 0;
      const endpoint = isKeywordSpecific
        ? `${API_BASE_URL}/trigger-keyword-analysis`
        : `${API_BASE_URL}/trigger-analysis`;
      
      const requestOptions: RequestInit = isKeywordSpecific
        ? {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ keywords: selectedKeywords }),
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

        await fetchExecutionStatus(arn);
        startPolling(arn);

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

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startMonitoring = useCallback((executionArn: string, executionName: string) => {
    const now = new Date().toISOString();
    setExecution({
      arn: executionArn,
      name: executionName,
      status: 'RUNNING',
      start_date: now,
      events: [],
    });

    fetchExecutionStatus(executionArn);
    startPolling(executionArn);
  }, [fetchExecutionStatus, startPolling]);

  return {
    execution,
    triggerAnalysis,
    startMonitoring,
    isRunning: execution?.status === 'RUNNING',
  };
};
