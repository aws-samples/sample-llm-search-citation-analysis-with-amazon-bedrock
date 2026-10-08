import {
  useState, useMemo 
} from 'react';
import type {
  AnalysisScope, Execution, Keyword, KeywordGroup 
} from '../../types';
import {
  API_BASE_URL, authenticatedFetch 
} from '../../infrastructure';
import { calculateDuration } from '../../formatting/dateFormatter';
import { useAlertModal } from '../../hooks/useAlertModal';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import { isKeywordActive } from '../Keywords/keywordEntry';
import { withMarketIds } from '../Markets/marketScope';
import { AlertModal } from '../ui/Modal';
import { processExecutionData } from '../../formatting/executionProcessor';
import {
  TriggerSection,
  ExecutionStatus,
} from './ExecutionMonitorComponents';

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marketIds, setMarketIds] = useState<string[]>([]);
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
          'No Providers Ready',
          'No LLM providers are enabled and configured. Go to Settings > AI Providers to add at least one API key.',
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

  const handleTriggerAnalysis = () => {
    const keywordScope: AnalysisScope | undefined = selectedIds.length > 0 ? {
      mode: 'keywords',
      keyword_ids: selectedIds
    } : undefined;
    // A market filter needs a scope; without one the classic run covers every keyword.
    if (marketIds.length === 0) return runWithPreflight(keywordScope);
    return runWithPreflight(withMarketIds(keywordScope ?? { mode: 'all' }, marketIds));
  };

  const handleRunGroup = (group: KeywordGroup) => runWithPreflight(withMarketIds({
    mode: 'groups',
    group_ids: [group.id] 
  }, marketIds));

  const processedExecution = useMemo(
    () => processExecutionData(execution),
    [execution]
  );

  const duration = execution ? calculateDuration(execution.start_date, execution.stop_date) : null;
  const isRunning = execution?.status === 'RUNNING';
  const {
    isAdmin, loading: adminLoading
  } = useIsAdmin();
  // Non-admins never see the picker, so only admins wait for the groups.
  const triggerLoading = adminLoading || (isAdmin && groupsLoading);

  return (
    <>
      <div className="space-y-6">
        <TriggerSection
          selectedIds={selectedIds}
          keywordsCount={keywordsCount}
          activeKeywords={activeKeywords}
          groups={groups}
          isRunning={isRunning}
          isStarting={isStarting}
          onSelectionChange={setSelectedIds}
          marketIds={marketIds}
          onMarketIdsChange={(next) => { setMarketIds(next); setSelectedIds([]); }}
          onTriggerAnalysis={() => { void handleTriggerAnalysis(); }}
          onRunGroup={(group) => { void handleRunGroup(group); }}
          isAdmin={isAdmin}
          loading={triggerLoading}
        />

        {execution && (
          <ExecutionStatus
            execution={execution}
            processedExecution={processedExecution}
            duration={duration}
            isRunning={isRunning}
          />
        )}
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
