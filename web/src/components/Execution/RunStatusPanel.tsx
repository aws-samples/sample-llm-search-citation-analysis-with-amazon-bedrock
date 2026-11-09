import type {
  Execution, ExecutionEvent
} from '../../types';
import { formatTime } from '../../formatting/dateFormatter';
import type {
  ProcessedExecution, StepState
} from '../../formatting/executionProcessor';
import { settingsPath } from '../Settings/settingsSections';
import {
  PageLink, RunCard
} from './RunCard';
import { RunDetails } from './RunDetails';
import {
  describeCurrentWork, runFailure, settledSteps, statusWords, type RunTone
} from './runOutcome';
import { plural } from './runTargets';
import { useRunDuration } from './useRunDuration';
import { WorkflowSteps } from './WorkflowSteps';

const DOT_STYLES: Record<RunTone, string> = {
  running: 'bg-gray-500 animate-pulse motion-reduce:animate-none',
  positive: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

const TITLE_ID = 'run-status-title';

function timingLine(execution: Execution, duration: string | null): string {
  const started = `Started ${formatTime(execution.start_date)}`;
  if (duration === null) return `${started}.`;
  if (execution.status === 'RUNNING') return `${started} · ${duration} so far. It keeps running if you leave this page.`;
  if (execution.status === 'SUCCEEDED') return `${started} · took ${duration}.`;
  return `${started} · stopped after ${duration}.`;
}

const ResultLinks = () => (
  <p className="text-sm text-gray-700">
    See the results in <PageLink to="/visibility">Visibility</PageLink>,{' '}
    <PageLink to="/searches">Recent Searches</PageLink> and <PageLink to="/raw-responses">Raw Responses</PageLink>.
  </p>
);

const Finished = ({ execution }: { readonly execution: Execution }) => {
  const failed = execution.progress?.keywords_failed ?? 0;
  return (
    <div className="space-y-1">
      <output className="block text-sm text-gray-900">
        The answers and citations are saved.
        {failed > 0 && <span className="text-amber-700"> {plural(failed, 'keyword')} failed and have no answers from this run.</span>}
      </output>
      <ResultLinks />
    </div>
  );
};

/** Opening words of the failure panel, by how the run ended and where. */
function failureSentence(execution: Execution, step: string | null): string {
  if (execution.status === 'TIMED_OUT') return 'The run took longer than the time it is allowed.';
  if (execution.status === 'ABORTED') return 'The run was stopped before it finished.';
  return step === null ? 'The run failed before it finished.' : `It failed at the step “${step}”.`;
}

interface StoppedProps {
  readonly execution: Execution;
  readonly steps: readonly StepState[];
  readonly events: readonly ExecutionEvent[];
}

const Stopped = ({
  execution, steps, events
}: StoppedProps) => {
  const failure = runFailure(steps, events);
  const isError = execution.status !== 'ABORTED';
  return (
    <div className="space-y-2">
      <output
        className={isError ? 'block rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700' : 'block text-sm text-gray-900'}
      >
        <span className={isError ? 'block font-medium' : 'block'}>{failureSentence(execution, failure.step)}</span>
        {failure.reason !== null && <span className="block mt-1 font-mono text-xs break-words">Reason: {failure.reason}</span>}
      </output>
      <p className="text-sm text-gray-700">
        Answers recorded before it stopped are kept in <PageLink to="/raw-responses">Raw Responses</PageLink>.
        {' '}Check the engines in <PageLink to={settingsPath('providers')}>AI providers</PageLink>, then start the run again below.
      </p>
    </div>
  );
};

interface RunStatusPanelProps {
  readonly execution: Execution;
  readonly processedExecution: ProcessedExecution;
}

/**
 * The run started from this page: its state in words with a status dot, how
 * long it has taken, the steps, then what happens now (live progress, where
 * the results are, or why it failed) and the details behind a disclosure.
 * Links out of the page are left out while it runs, so leaving still asks first.
 */
export const RunStatusPanel = ({
  execution, processedExecution
}: RunStatusPanelProps) => {
  const isRunning = execution.status === 'RUNNING';
  const duration = useRunDuration(execution.start_date, execution.stop_date, isRunning);
  const words = statusWords(execution);
  const steps = settledSteps(execution.status, processedExecution.steps);
  return (
    <RunCard
      titleId={TITLE_ID}
      title={<><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT_STYLES[words.tone]}`} />{words.title}</>}
      description={timingLine(execution, duration)}
      footer={<RunDetails execution={execution} events={processedExecution.events} isRunning={isRunning} />}
    >
      <div className="space-y-5">
        <WorkflowSteps steps={steps} />
        {isRunning && (
          // For screen readers: the stepper already shows the same words and counts.
          <output className="sr-only">{describeCurrentWork(steps, execution.progress)}</output>
        )}
        {execution.status === 'SUCCEEDED' && <Finished execution={execution} />}
        {!isRunning && execution.status !== 'SUCCEEDED' && <Stopped execution={execution} steps={steps} events={processedExecution.events} />}
      </div>
    </RunCard>
  );
};
