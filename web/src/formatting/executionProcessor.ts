/**
 * Execution processing utilities.
 *
 * The analysis workflow is ParseKeywords -> ProcessKeywords -> GenerateSummary.
 * ProcessKeywords is a Distributed Map: every keyword's search, dedupe and
 * crawl runs in a child execution, so the parent history only shows the map
 * state and its map run, and keyword progress comes from the status API's
 * `progress` counts. Runs started before the Distributed Map still carry the
 * per-keyword states (SearchAllProviders, DeduplicateCitations, ...); those
 * are folded into the ProcessKeywords step.
 */

import type {
  Execution, ExecutionEvent 
} from '../types';
import { calculateDuration } from './dateFormatter';

/** Keyword counts of a run's ProcessKeywords map run. */
export type KeywordProgress = NonNullable<Execution['progress']>;

export interface StepState {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  error?: string;
  /** What the step does, for a step whose name alone does not say. */
  description?: string;
  /** Keyword counts, on the ProcessKeywords step once its map run reports them. */
  keywords?: KeywordProgress;
}

export interface ProcessedExecution {
  status: string;
  startDate: string;
  endDate?: string;
  duration?: string | null;
  steps: StepState[];
  events: ExecutionEvent[];
  logs: ExecutionEvent[];
  currentStep?: string;
  /** Overall completion, 0-100. */
  progress: number;
}

const PROCESS_KEYWORDS = 'ProcessKeywords';

const WORKFLOW_STEPS = [
  'ParseKeywords',
  PROCESS_KEYWORDS,
  'GenerateSummary',
];

/**
 * Share of the overall progress each step is worth (sums to 100). The keyword
 * step is the bulk of a run and fills in keyword by keyword.
 */
const STEP_WEIGHTS: Record<string, number> = {
  ParseKeywords: 10,
  [PROCESS_KEYWORDS]: 80,
  GenerateSummary: 10,
};

const STEP_DESCRIPTIONS: Record<string, string> = {[PROCESS_KEYWORDS]: 'Search, dedupe and crawl per keyword',};

/**
 * Per-keyword states of runs started before ProcessKeywords became a
 * Distributed Map. One keyword finishing a state does not finish the step,
 * so their events only ever mark ProcessKeywords running (or failed).
 */
const PER_KEYWORD_STATES = new Set([
  'SearchAllProviders',
  'DeduplicateCitations',
  'Deduplication',
  'CrawlCitations',
  'CrawlSingleCitation',
  'Crawl',
]);

interface StepEvent {
  type?: string;
  timestamp?: string;
  error?: string;
}

type StepEventKind = 'started' | 'succeeded' | 'failed';

const STEP_STARTED_EVENT_TYPES = new Set([
  'TaskStarted', 'TaskScheduled', 'TaskStateEntered', 'MapStateEntered', 'MapStateStarted', 'MapRunStarted',
]);
const STEP_SUCCEEDED_EVENT_TYPES = new Set(['TaskSucceeded', 'TaskStateExited', 'MapStateExited', 'MapRunSucceeded']);
const STEP_FAILED_EVENT_TYPES = new Set(['TaskFailed', 'MapRunFailed']);

/**
 * What an event means for its step. Checked in this order so a succeeded
 * event that also carries an error still counts as succeeded; an event with
 * an error but an unrelated type counts as failed.
 */
function stepEventKind(event: StepEvent): StepEventKind | undefined {
  if (STEP_STARTED_EVENT_TYPES.has(event.type ?? '')) return 'started';
  if (STEP_SUCCEEDED_EVENT_TYPES.has(event.type ?? '')) return 'succeeded';
  if (STEP_FAILED_EVENT_TYPES.has(event.type ?? '') || event.error) return 'failed';
  return undefined;
}

/** The workflow step index a state name belongs to, or -1. */
function stepIndexFor(stateName: string): number {
  if (PER_KEYWORD_STATES.has(stateName)) return WORKFLOW_STEPS.indexOf(PROCESS_KEYWORDS);
  // Exact name first, then a state whose name contains a step name.
  const exact = WORKFLOW_STEPS.indexOf(stateName);
  return exact === -1 ? WORKFLOW_STEPS.findIndex(step => stateName.includes(step)) : exact;
}

/** The kind an event has for its step; per-keyword successes only mean the keyword step is under way. */
function kindForStep(event: ExecutionEvent): StepEventKind | undefined {
  const kind = stepEventKind(event);
  return kind === 'succeeded' && PER_KEYWORD_STATES.has(event.state_name ?? '') ? 'started' : kind;
}

function pendingSteps(): StepState[] {
  return WORKFLOW_STEPS.map(name => ({
    name,
    status: 'pending',
    ...(STEP_DESCRIPTIONS[name] ? { description: STEP_DESCRIPTIONS[name] } : {}),
  }));
}

/** Share of the keywords that finished (succeeded or failed), 0-1; 0 when there are none to count. */
function keywordFraction(keywords: KeywordProgress | null | undefined): number {
  if (!keywords || keywords.keywords_total <= 0) return 0;
  const done = keywords.keywords_succeeded + keywords.keywords_failed;
  return Math.min(1, done / keywords.keywords_total);
}

/**
 * Overall completion: every completed step's weight, plus the finished share
 * of the keyword step while it runs (or after it failed). Never goes down as
 * a run advances: the keyword step is worth its full weight once completed.
 */
function progressPercent(steps: StepState[], keywords: KeywordProgress | null | undefined): number {
  const total = steps.reduce((sum, step) => {
    const weight = STEP_WEIGHTS[step.name] ?? 0;
    if (step.status === 'completed') return sum + weight;
    if (step.name === PROCESS_KEYWORDS && step.status !== 'pending') return sum + weight * keywordFraction(keywords);
    return sum;
  }, 0);
  return Math.round(total);
}

function applyEvents(steps: StepState[], events: ExecutionEvent[]): void {
  // Track the latest event timestamp for each step to handle retries correctly
  const stepLatestTimestamp: Record<number, string> = {};

  // When a step starts, every earlier step is over.
  const markPreviousStepsCompleted = (currentStepIndex: number) => {
    steps.slice(0, currentStepIndex).forEach((step) => {
      if (step.status === 'running' || step.status === 'pending') {
        step.status = 'completed';
      }
    });
  };

  const updateStep = (index: number, event: ExecutionEvent) => {
    const eventTimestamp = event.timestamp ?? '';
    // Only update if this event is newer than the last one we processed for this step
    if (eventTimestamp < (stepLatestTimestamp[index] ?? '')) return;
    stepLatestTimestamp[index] = eventTimestamp;

    const step = steps[index];
    const kind = kindForStep(event);
    if (kind === 'started') {
      markPreviousStepsCompleted(index);
      // Only set to running if not already completed
      if (step.status !== 'completed') {
        step.status = 'running';
        step.startTime = event.timestamp;
      }
    } else if (kind === 'succeeded') {
      // Mark as completed - this takes precedence over running/failed
      step.status = 'completed';
      step.endTime = event.timestamp;
    } else if (kind === 'failed' && step.status !== 'completed') {
      // Only mark as failed if not already completed (retries may have succeeded)
      step.status = 'failed';
      step.error = event.error;
      step.endTime = event.timestamp;
    }
  };

  // Sort events by timestamp to process in chronological order
  const sortedEvents = [...events].sort((a, b) => 
    (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  );
  for (const event of sortedEvents) {
    const stepIndex = stepIndexFor(event.state_name ?? '');
    if (stepIndex !== -1) updateStep(stepIndex, event);
  }
}

export function processExecutionData(execution: Execution | null): ProcessedExecution {
  if (!execution) {
    return {
      status: 'IDLE',
      startDate: '',
      steps: pendingSteps(),
      events: [],
      logs: [],
      progress: 0,
    };
  }

  const steps = pendingSteps();
  applyEvents(steps, execution.events);

  const keywords = execution.progress;
  if (keywords) steps[WORKFLOW_STEPS.indexOf(PROCESS_KEYWORDS)].keywords = keywords;

  const runningStepIndex = steps.findIndex(s => s.status === 'running');

  return {
    status: execution.status,
    startDate: execution.start_date,
    endDate: execution.stop_date,
    duration: calculateDuration(execution.start_date, execution.stop_date),
    steps,
    events: execution.events,
    logs: execution.events,
    currentStep: runningStepIndex >= 0 ? WORKFLOW_STEPS[runningStepIndex] : undefined,
    progress: progressPercent(steps, keywords),
  };
}
