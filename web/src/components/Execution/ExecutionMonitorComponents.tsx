import type {
  Keyword, KeywordGroup, ExecutionEvent, Execution
} from '../../types';
import {
  formatDate, formatTime
} from '../../formatting/dateFormatter';
import { Spinner } from '../ui/Spinner';
import { KeywordScopePicker } from '../ui/KeywordScopePicker';
import { PlayIcon } from '../ui';
import type {
  StepState, ProcessedExecution
} from '../../formatting/executionProcessor';

const getStatusStyle = (status: string): string => {
  const styles: Record<string, string> = {
    RUNNING: 'bg-gray-100 text-gray-700',
    SUCCEEDED: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-600';
};

const getStepStyle = (status: string): string => {
  const styles: Record<string, string> = {
    running: 'border-gray-400 bg-gray-50',
    completed: 'border-emerald-400 bg-emerald-50',
    failed: 'border-red-400 bg-red-50',
  };
  return styles[status] ?? 'border-gray-200 bg-gray-50';
};

const getStepIndicator = (status: string): JSX.Element => {
  if (status === 'running') return <div className="w-2.5 h-2.5 bg-gray-500 rounded-full animate-pulse" />;
  if (status === 'completed') return <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />;
  if (status === 'failed') return <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />;
  return <div className="w-2.5 h-2.5 bg-gray-300 rounded-full" />;
};

const getExecutionTitle = (status: string): string => {
  const titles: Record<string, string> = {
    RUNNING: 'Analysis Running',
    SUCCEEDED: 'Analysis Completed',
    FAILED: 'Analysis Failed',
  };
  return titles[status] ?? `Analysis ${status}`;
};

const getLogItemStyle = (event: ExecutionEvent): string => {
  if (event.error) return 'bg-red-50 border-red-200';
  if (event.type.includes('Succeeded')) return 'bg-emerald-50 border-emerald-200';
  return 'bg-gray-50 border-gray-200';
};

function formatEventMessage(event: ExecutionEvent): string {
  const eventType = event.type;
  const stateName = event.state_name ?? '';
  const startedMessages: Record<string, string> = {
    ParseKeywords: 'Parsing keywords from S3',
    SearchAllProviders: 'Searching all providers',
    Deduplication: 'Deduplicating citations',
    Crawl: 'Crawling web pages',
    GenerateSummary: 'Generating summary',
  };
  const succeededMessages: Record<string, string> = {
    ParseKeywords: 'Keywords parsed',
    SearchAllProviders: 'Search completed',
    Deduplication: 'Deduplication completed',
    Crawl: 'Crawling completed',
    GenerateSummary: 'Summary generated',
  };
  if (eventType === 'TaskStarted' || eventType === 'TaskScheduled') {
    for (const [key, msg] of Object.entries(startedMessages)) {
      if (stateName.includes(key)) return msg;
    }
  }
  if (eventType === 'TaskSucceeded') {
    for (const [key, msg] of Object.entries(succeededMessages)) {
      if (stateName.includes(key)) return msg;
    }
  }
  return event.message ?? eventType;
}

interface TriggerSectionProps {
  selectedIds: string[];
  keywordsCount: number;
  activeKeywords: Keyword[];
  groups: KeywordGroup[];
  isRunning: boolean;
  isStarting: boolean;
  onSelectionChange: (selectedIds: string[]) => void;
  onTriggerAnalysis: () => void;
  onRunGroup: (group: KeywordGroup) => void;
  /** Both trigger routes are Admin-only server-side. */
  isAdmin: boolean;
}

export const TriggerSection = ({
  selectedIds, keywordsCount, activeKeywords, groups, isRunning, isStarting,
  onSelectionChange, onTriggerAnalysis, onRunGroup, isAdmin,
}: TriggerSectionProps) => {
  const getKeywordCountText = (): string => {
    // `activeKeywords`, not `keywordsCount`: the latter is every keyword in the
    // library, so an install with paused keywords was told it would run "All 53
    // active keywords" when a no-selection run resolves to the active ones only.
    if (selectedIds.length === 0) return `All ${activeKeywords.length} active keywords`;
    const plural = selectedIds.length > 1 ? 's' : '';
    return `${selectedIds.length} keyword${plural} selected`;
  };

  // POST /api/trigger-analysis and /api/trigger-keyword-analysis are Admin-only:
  // one request fans out paid provider calls across every keyword and persona.
  // Non-admins keep the execution history below this panel.
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 className="text-sm font-medium text-gray-900 mb-2">Run Citation Analysis</h2>
        <p className="text-sm text-gray-500">
          Starting an analysis requires an administrator. Completed runs are shown below.
        </p>
      </div>
    );
  }

  const busy = isRunning || isStarting;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 className="text-sm font-medium text-gray-900 mb-2">Run Citation Analysis</h2>
      <p className="text-sm text-gray-500 mb-4">{getKeywordCountText()}</p>
      {groups.length > 0 && (
        <GroupQuickRun groups={groups} disabled={busy} onRunGroup={onRunGroup} />
      )}
      {activeKeywords.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">Select keywords (optional)</p>
          <KeywordScopePicker
            idPrefix="execution-keyword-scope"
            name="execution-keyword-ids"
            keywords={activeKeywords}
            groups={groups}
            selectedIds={selectedIds}
            onChange={onSelectionChange}
            disabled={busy}
          />
        </div>
      )}
      <TriggerButton
        keywordsCount={keywordsCount}
        isRunning={isRunning}
        isStarting={isStarting}
        onTriggerAnalysis={onTriggerAnalysis}
      />
    </div>
  );
};

interface GroupQuickRunProps {
  groups: KeywordGroup[];
  disabled: boolean;
  onRunGroup: (group: KeywordGroup) => void;
}

/** One-click "run this whole group" buttons; resolved server-side at run time. */
const GroupQuickRun = ({
  groups, disabled, onRunGroup
}: GroupQuickRunProps) => (
  <div className="mb-4">
    <p className="text-sm text-gray-600 mb-2">Run a whole keyword group</p>
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onRunGroup(group)}
          disabled={disabled || group.keyword_count === 0}
          // The count is of active members, so 0 means the group holds only
          // paused keywords and a run would resolve to nothing. Say so, rather
          // than leaving a dead button with no explanation.
          title={group.keyword_count === 0 ? `${group.name} has no active keywords to run` : undefined}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {group.name}
          <span className="ml-1 text-xs text-gray-400">({group.keyword_count})</span>
        </button>
      ))}
    </div>
  </div>
);

interface TriggerButtonProps {
  keywordsCount: number;
  isRunning: boolean;
  isStarting: boolean;
  onTriggerAnalysis: () => void;
}

const TriggerButton = ({
  keywordsCount, isRunning, isStarting, onTriggerAnalysis
}: TriggerButtonProps) => (
  <>
    <button
      onClick={onTriggerAnalysis}
      disabled={keywordsCount === 0 || isRunning || isStarting}
      className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
    >
      {isStarting ? (
        <><Spinner size="sm" />Starting...</>
      ) : (
        <><PlayIcon className="w-4 h-4" />Start Analysis</>
      )}
    </button>
    {keywordsCount === 0 && <p className="text-sm text-red-600 mt-2">Add keywords first</p>}
    {isRunning && <RunningIndicator />}
  </>
);

const RunningIndicator = () => (
  <p className="text-sm text-gray-500 mt-2 flex items-center gap-2">
    <span className="flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
    </span>
    Analysis running...
  </p>
);

interface ExecutionStatusProps {
  execution: Execution;
  processedExecution: ProcessedExecution;
  duration: string | null;
  isRunning: boolean;
}

export const ExecutionStatus = ({
  execution, processedExecution, duration, isRunning
}: ExecutionStatusProps) => (
  <div className="bg-white rounded-lg border border-gray-200">
    <ExecutionHeader execution={execution} duration={duration} />
    <WorkflowSteps steps={processedExecution.steps} />
    <ExecutionLogs logs={processedExecution.events} isRunning={isRunning} />
  </div>
);

interface ExecutionHeaderProps {
  execution: Execution;
  duration: string | null;
}

const ExecutionHeader = ({
  execution, duration
}: ExecutionHeaderProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
      <div>
        <h2 className="text-sm font-medium text-gray-900">{getExecutionTitle(execution.status)}</h2>
        <p className="text-xs text-gray-500 mt-1 truncate max-w-[200px] sm:max-w-none">{execution.name ?? 'Unnamed'}</p>
      </div>
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium self-start ${getStatusStyle(execution.status)}`}>
        {execution.status}
      </span>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
      <div>
        <span className="text-gray-500 text-xs sm:text-sm">Started</span>
        <p className="text-gray-900 mt-0.5 text-xs sm:text-sm">{formatDate(execution.start_date)}</p>
      </div>
      {execution.stop_date && (
        <div>
          <span className="text-gray-500 text-xs sm:text-sm">Completed</span>
          <p className="text-gray-900 mt-0.5 text-xs sm:text-sm">{formatDate(execution.stop_date)}</p>
        </div>
      )}
      {duration && (
        <div>
          <span className="text-gray-500 text-xs sm:text-sm">Duration</span>
          <p className="text-gray-900 font-medium mt-0.5 text-xs sm:text-sm">{duration}</p>
        </div>
      )}
    </div>
  </div>
);

interface WorkflowStepsProps { steps: StepState[]; }

const WorkflowSteps = ({ steps }: WorkflowStepsProps) => (
  <div className="p-4 sm:p-6 border-b border-gray-200 bg-gray-50">
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
      <h3 className="text-sm font-medium text-gray-900">Workflow</h3>
      <StepLegend />
    </div>
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {steps.map((step, idx) => (
        <StepItem key={step.name} step={step} isLast={idx === steps.length - 1} />
      ))}
    </div>
  </div>
);

const StepLegend = () => (
  <div className="flex items-center gap-3 sm:gap-4 text-xs text-gray-500">
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-gray-300 rounded-full"></div><span>Pending</span></div>
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div><span>Running</span></div>
    <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-500 rounded-full"></div><span>Done</span></div>
  </div>
);

interface StepItemProps {
  step: StepState;
  isLast: boolean;
}

const StepItem = ({
  step, isLast
}: StepItemProps) => (
  <div className="flex items-center">
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border min-w-[140px] ${getStepStyle(step.status)}`}>
      {getStepIndicator(step.status)}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-900 truncate">{step.name}</p>
        {step.status === 'running' && <p className="text-xs text-gray-500">In progress</p>}
      </div>
    </div>
    {!isLast && <div className="w-6 h-px bg-gray-300 mx-1" />}
  </div>
);

interface ExecutionLogsProps {
  logs: ExecutionEvent[];
  isRunning: boolean;
}

const ExecutionLogs = ({
  logs, isRunning
}: ExecutionLogsProps) => (
  <div className="p-4 sm:p-6">
    <div className="flex justify-between items-center mb-4">
      <h3 className="text-sm font-medium text-gray-900">Execution Log</h3>
      {logs.length > 0 && <span className="text-xs text-gray-500">{logs.length} events</span>}
    </div>
    <div className="space-y-2 max-h-60 sm:max-h-80 overflow-y-auto">
      {logs.length > 0 ? (
        logs.map((event) => <LogItem key={event.id ?? event.timestamp} event={event} />)
      ) : (
        <EmptyLogs isRunning={isRunning} />
      )}
    </div>
  </div>
);

interface LogItemProps { event: ExecutionEvent; }
interface EmptyLogsProps { isRunning: boolean; }

const LogItem = ({ event }: LogItemProps) => (
  <div className={`p-3 rounded-lg border text-sm ${getLogItemStyle(event)}`}>
    <div className="flex justify-between items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900">{formatEventMessage(event)}</p>
        {event.details && <p className="text-gray-600 mt-1">{event.details}</p>}
        {event.error && <p className="text-red-600 mt-1 font-mono text-xs">{event.error}</p>}
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap">{formatTime(event.timestamp)}</span>
    </div>
  </div>
);

const EmptyLogs = ({ isRunning }: EmptyLogsProps) => (
  <div className="text-center py-8">
    {isRunning ? (
      <div className="flex flex-col items-center gap-3">
        <Spinner className="text-gray-400" />
        <p className="text-sm text-gray-500">Loading events...</p>
      </div>
    ) : (
      <p className="text-sm text-gray-400">No events recorded</p>
    )}
  </div>
);
