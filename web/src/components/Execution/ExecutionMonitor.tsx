import {
  useState, useMemo 
} from 'react';
import type {
  AnalysisScope, Execution, Keyword
} from '../../types';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import { useAlertModal } from '../../hooks/useAlertModal';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { isKeywordActive } from '../Keywords/keywordEntry';
import { AlertModal } from '../ui/Modal';
import { processExecutionData } from '../../formatting/executionProcessor';
import { RunStatusPanel } from './RunStatusPanel';
import { TriggerSection } from './TriggerSection';
import {
  EVERY_KEYWORD_RUN, runSelectionScope, type RunSelection
} from './runSelection';

interface ExecutionMonitorProps {
  execution: Execution | null;
  triggerAnalysis: (scope?: AnalysisScope) => Promise<{
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
  const [selection, setSelection] = useState<RunSelection>(EVERY_KEYWORD_RUN);
  const [isStarting, setIsStarting] = useState(false);
  const {
    alertModal, showAlert, closeAlert
  } = useAlertModal();
  const {
    groups, loading: groupsLoading
  } = useKeywordGroups();

  // Same rule the keyword list and the API use, kept in one place.
  const activeKeywords = keywords.filter(isKeywordActive);

  const runWithPreflight = async (scope: AnalysisScope | undefined) => {
    setIsStarting(true);
    try {
      const preflight = await checkLlmProvidersReady();
      if (preflight === null) {
        // Don't block analysis if preflight check itself fails
        console.warn('[preflight] Provider check failed, proceeding anyway');
      } else if (!preflight.anyReady) {
        showAlert(
          'No AI engine is ready',
          'No AI engine is enabled with an API key. Add one in Settings › AI providers, then start the run again.',
          'error'
        );
        return;
      } else if (preflight.missingKeyProviders.length > 0) {
        console.warn(`[preflight] ${preflight.missingKeyProviders.length} enabled provider(s) missing API keys: ${preflight.missingKeyProviders.join(', ')}`);
      }

      const result = await triggerAnalysis(scope);
      showAlert(
        result.success ? 'Success' : 'Error',
        result.message,
        result.success ? 'success' : 'error'
      );
    } finally {
      setIsStarting(false);
    }
  };

  const handleTriggerAnalysis = () => runWithPreflight(runSelectionScope(selection));

  const processedExecution = useMemo(
    () => processExecutionData(execution),
    [execution]
  );

  const isRunning = execution?.status === 'RUNNING';
  const {
    isAdmin, loading: adminLoading
  } = useIsAdmin();
  // Non-admins never see the picker, so only admins wait for the groups.
  const triggerLoading = adminLoading || (isAdmin && groupsLoading);

  return (
    <>
      <div className="space-y-6">
        {/* The run started here comes first: it is what the user came back to see. */}
        {execution && <RunStatusPanel execution={execution} processedExecution={processedExecution} />}

        <TriggerSection
          selection={selection}
          onSelectionChange={setSelection}
          keywordsCount={keywordsCount}
          activeKeywords={activeKeywords}
          groups={groups}
          isRunning={isRunning}
          isStarting={isStarting}
          onTriggerAnalysis={() => { void handleTriggerAnalysis(); }}
          isAdmin={isAdmin}
          loading={triggerLoading}
        />
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={closeAlert}
        title={alertModal.title}
        message={alertModal.message}
        variant={alertModal.variant}
      />
    </>
  );
};
