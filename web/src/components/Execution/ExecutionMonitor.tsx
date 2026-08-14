import {
  useState, useMemo 
} from 'react';
import type {
  Execution, Keyword 
} from '../../types';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import { calculateDuration } from '../../formatting/dateFormatter';
import { AlertModal } from '../ui/Modal';
import { processExecutionData } from '../../formatting/executionProcessor';
import {
  TriggerSection,
  ExecutionStatus,
} from './ExecutionMonitorComponents';

interface ExecutionMonitorProps {
  execution: Execution | null;
  triggerAnalysis: (selectedKeywords?: string[]) => Promise<{
    success: boolean;
    message: string;
  }>;
  keywordsCount: number;
  keywords: Keyword[];
}

interface ProviderPreflightRecord {
  name: string;
  enabled: boolean;
  configured: boolean;
  type: string;
}

interface ProviderPreflightResult {
  anyReady: boolean;
  missingKeyProviders: string[];
}

/**
 * Pre-flight provider health check before triggering an analysis.
 * Returns null when the check itself fails, in which case the analysis
 * should proceed rather than be blocked.
 */
async function checkLlmProvidersReady(): Promise<ProviderPreflightResult | null> {
  try {
    const provResp = await authenticatedFetch(`${API_BASE_URL}/providers`);
    if (!provResp.ok) return null;
    const data = await provResp.json() as { providers: ProviderPreflightRecord[] };
    const llmProviders = (data.providers ?? []).filter(p => p.type === 'llm');
    return {
      anyReady: llmProviders.some(p => p.enabled && p.configured),
      missingKeyProviders: llmProviders.filter(p => p.enabled && !p.configured).map(p => p.name),
    };
  } catch {
    return null;
  }
}

export const ExecutionMonitor = ({
  execution,
  triggerAnalysis,
  keywordsCount,
  keywords,
}: ExecutionMonitorProps) => {
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    variant: 'info',
  });

  const activeKeywords = keywords.filter((k) => !k.status || k.status === 'active');

  const handleToggleKeyword = (keyword: string) => {
    setSelectedKeywords((prev) =>
      prev.includes(keyword) ? prev.filter((k) => k !== keyword) : [...prev, keyword]
    );
  };

  const handleSelectAll = () => {
    const allSelected = selectedKeywords.length === activeKeywords.length;
    setSelectedKeywords(allSelected ? [] : activeKeywords.map((k) => k.keyword));
  };

  const handleTriggerAnalysis = async () => {
    setIsStarting(true);
    try {
      const preflight = await checkLlmProvidersReady();
      if (preflight === null) {
        // Don't block analysis if preflight check itself fails
        console.warn('[preflight] Provider check failed, proceeding anyway');
      } else if (!preflight.anyReady) {
        setAlertModal({
          isOpen: true,
          title: 'No Providers Ready',
          message: 'No LLM providers are enabled and configured. Go to Settings > AI Providers to add at least one API key.',
          variant: 'error',
        });
        return;
      } else if (preflight.missingKeyProviders.length > 0) {
        console.warn(`[preflight] ${preflight.missingKeyProviders.length} enabled provider(s) missing API keys: ${preflight.missingKeyProviders.join(', ')}`);
      }

      const keywordsToRun = selectedKeywords.length > 0 ? selectedKeywords : undefined;
      const result = await triggerAnalysis(keywordsToRun);
      setAlertModal({
        isOpen: true,
        title: result.success ? 'Success' : 'Error',
        message: result.message,
        variant: result.success ? 'success' : 'error',
      });
    } finally {
      setIsStarting(false);
    }
  };

  const processedExecution = useMemo(
    () => processExecutionData(execution),
    [execution]
  );

  const duration = execution ? calculateDuration(execution.start_date, execution.stop_date) : null;
  const isRunning = execution?.status === 'RUNNING';

  return (
    <>
      <div className="space-y-6">
        <TriggerSection
          selectedKeywords={selectedKeywords}
          keywordsCount={keywordsCount}
          activeKeywords={activeKeywords}
          isRunning={isRunning ?? false}
          isStarting={isStarting}
          onSelectAll={handleSelectAll}
          onToggleKeyword={handleToggleKeyword}
          onTriggerAnalysis={handleTriggerAnalysis}
        />

        {execution && processedExecution && (
          <ExecutionStatus
            execution={execution}
            processedExecution={processedExecution}
            duration={duration}
            isRunning={isRunning ?? false}
          />
        )}
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={() => setAlertModal({
          ...alertModal,
          isOpen: false 
        })}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </>
  );
};
