import type {
  Execution, ExecutionEvent, ExecutionStatus
} from '../../types';
import type {
  KeywordProgress, StepState
} from '../../formatting/executionProcessor';
import { plural } from './runTargets';

interface StepWords {
  /** The step as a stepper label. */
  readonly label: string;
  /** The step under way, for the live progress line. */
  readonly doing: string;
}

/** The workflow's states in the user's words; ids stay in the activity log. */
const STEP_WORDS: Readonly<Record<string, StepWords>> = {
  ParseKeywords: {
    label: 'Prepare keywords',
    doing: 'Preparing the keywords',
  },
  ProcessKeywords: {
    label: 'Ask AI engines and crawl sources',
    doing: 'Asking the AI engines and crawling the cited pages',
  },
  GenerateSummary: {
    label: 'Write summary',
    doing: 'Writing the summary',
  },
};

export function stepWords(stepName: string): StepWords {
  return STEP_WORDS[stepName] ?? {
    label: stepName,
    doing: stepName,
  };
}

export type RunTone = 'running' | 'positive' | 'warning' | 'error';

interface StatusWords {
  readonly title: string;
  readonly tone: RunTone;
}

const STATUS_WORDS: Readonly<Record<ExecutionStatus, StatusWords>> = {
  RUNNING: {
    title: 'Run in progress',
    tone: 'running',
  },
  SUCCEEDED: {
    title: 'Run finished',
    tone: 'positive',
  },
  FAILED: {
    title: 'Run failed',
    tone: 'error',
  },
  TIMED_OUT: {
    title: 'Run timed out',
    tone: 'error',
  },
  ABORTED: {
    title: 'Run stopped',
    tone: 'warning',
  },
};

/** Title and tone of a run; a finished run with failed keywords is a warning. */
export function statusWords(execution: Execution): StatusWords {
  const words = STATUS_WORDS[execution.status];
  if (execution.status === 'SUCCEEDED' && (execution.progress?.keywords_failed ?? 0) > 0) {
    return {
      title: 'Run finished with failures',
      tone: 'warning',
    };
  }
  return words;
}

/** "10 of 20 keywords done" (done = succeeded + failed), "· 3 failed" when some failed. */
export function describeKeywordProgress(progress: KeywordProgress): string {
  const done = progress.keywords_succeeded + progress.keywords_failed;
  const base = `${done.toLocaleString()} of ${plural(progress.keywords_total, 'keyword')} done`;
  return progress.keywords_failed > 0 ? `${base} · ${progress.keywords_failed.toLocaleString()} failed` : base;
}

/** The live line of a running run: the step under way and its keyword counts. */
export function describeCurrentWork(steps: readonly StepState[], progress: KeywordProgress | null | undefined): string {
  const current = steps.find((step) => step.status === 'running');
  if (current === undefined) return 'Starting…';
  const doing = stepWords(current.name).doing;
  return progress ? `${doing}: ${describeKeywordProgress(progress)}.` : `${doing}…`;
}

export interface RunFailure {
  /** The step that failed, in the user's words, when one did. */
  readonly step: string | null;
  /** The error the workflow reported, when it reported one. */
  readonly reason: string | null;
}

/** Newest event carrying an error: the history comes newest first, but sort to be sure. */
function latestError(events: readonly ExecutionEvent[]): ExecutionEvent | undefined {
  return [...events]
    .filter((event) => event.error)
    .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))[0];
}

/** Where and why a run that did not finish stopped. */
export function runFailure(steps: readonly StepState[], events: readonly ExecutionEvent[]): RunFailure {
  const failedStep = steps.find((step) => step.status === 'failed');
  const reason = failedStep?.error ?? latestError(events)?.error ?? null;
  return {
    step: failedStep ? stepWords(failedStep.name).label : null,
    reason,
  };
}

/**
 * The steps as the run's final status settles them: every step is done once
 * the run succeeded, and a step still marked under way in a run that ended
 * otherwise is where it stopped. The event history alone can miss either.
 */
export function settledSteps(status: ExecutionStatus, steps: readonly StepState[]): StepState[] {
  if (status === 'RUNNING') return [...steps];
  if (status === 'SUCCEEDED') return steps.map((step) => ({
    ...step,
    status: 'completed',
  }));
  return steps.map((step) => (step.status === 'running' ? {
    ...step,
    status: 'failed',
  } : step));
}
