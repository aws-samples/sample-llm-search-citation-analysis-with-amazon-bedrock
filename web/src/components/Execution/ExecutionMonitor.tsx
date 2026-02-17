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
      // Pre-flight: check provider health before running
      try {
        const provResp = await authenticatedFetch(`${API_BASE_URL}/providers`);
        if (provResp.ok) {
          const data = await provResp.json() as { providers: Array<{
            name: string;
            enabled: boolean;
            configured: boolean;
            type: string;
          }> };
          const llmProviders = (data.providers ?? []).filter(p => p.type === 'llm');
          const ready = llmProviders.filter(p => p.enabled && p.configured);
          if (ready.length === 0) {
            setAlertModal({
              isOpen: true,
              title: 'No Providers Ready',
              message: 'No LLM providers are enabled and configured. Go to Settings > AI Providers to add at least one API key.',
              variant: 'error',
            });
            return;
          }
          const notReady = llmProviders.filter(p => p.enabled && !p.configured);
          if (notReady.length > 0) {
            console.warn(`[preflight] ${notReady.length} enabled provider(s) missing API keys: ${notReady.map(p => p.name).join(', ')}`);
          }
        }
      } catch {
        // Don't block analysis if preflight check itself fails
        console.warn('[preflight] Provider check failed, proceeding anyway');
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
