/**
 * Execution processing utilities.
 */

import type {
  Execution, ExecutionEvent 
} from '../types';
import { calculateDuration } from './dateFormatter';

export interface StepState {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  error?: string;
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
  progress: number;
}

const WORKFLOW_STEPS = [
  'ParseKeywords',
  'SearchAllProviders', 
  'Deduplication',
  'Crawl',
  'GenerateSummary',
];

// Map actual state names to workflow step names
const STATE_NAME_TO_STEP: Record<string, string> = {
  'ParseKeywords': 'ParseKeywords',
  'SearchAllProviders': 'SearchAllProviders',
  'DeduplicateCitations': 'Deduplication',
  'Deduplication': 'Deduplication',
  'CrawlSingleCitation': 'Crawl',
  'CrawlCitations': 'Crawl',
  'Crawl': 'Crawl',
  'GenerateSummary': 'GenerateSummary',
};

export function processExecutionData(execution: Execution | null): ProcessedExecution {
  if (!execution) {
    return {
      status: 'IDLE',
      startDate: '',
      steps: WORKFLOW_STEPS.map(name => ({
        name,
        status: 'pending' 
      })),
      events: [],
      logs: [],
      progress: 0,
    };
  }

  const steps: StepState[] = WORKFLOW_STEPS.map(name => ({
    name,
    status: 'pending' as const,
  }));

  // Track the latest event timestamp for each step to handle retries correctly
  const stepLatestTimestamp: Record<number, string> = {};

  const updateStep = (index: number, event: {
    type?: string;
    timestamp?: string;
    error?: string 
  }) => {
    const eventTimestamp = event.timestamp ?? '';
    const currentTimestamp = stepLatestTimestamp[index] ?? '';
    
    // Only update if this event is newer than the last one we processed for this step
    if (eventTimestamp < currentTimestamp) {
      return;
    }
    stepLatestTimestamp[index] = eventTimestamp;
    
    if (event.type === 'TaskStarted' || event.type === 'TaskScheduled' || event.type === 'TaskStateEntered') {
      // When a step starts, mark all previous steps as completed
      markPreviousStepsCompleted(index);
      // Only set to running if not already completed
      if (steps[index].status !== 'completed') {
        steps[index].status = 'running';
        steps[index].startTime = event.timestamp;
      }
    } else if (event.type === 'TaskSucceeded' || event.type === 'TaskStateExited' || event.type === 'MapStateExited') {
      // Mark as completed - this takes precedence over running/failed
      steps[index].status = 'completed';
      steps[index].endTime = event.timestamp;
    } else if (event.type === 'TaskFailed' || event.error) {
      // Only mark as failed if not already completed (retries may have succeeded)
      if (steps[index].status !== 'completed') {
        steps[index].status = 'failed';
        steps[index].error = event.error;
        steps[index].endTime = event.timestamp;
      }
    }
  };

  // Sort events by timestamp to process in chronological order
  const sortedEvents = [...execution.events].sort((a, b) => 
    (a.timestamp ?? '').localeCompare(b.timestamp ?? '')
  );

  // Helper: when a step starts, mark all previous steps as completed
  const markPreviousStepsCompleted = (currentStepIndex: number) => {
    steps.slice(0, currentStepIndex).forEach((step) => {
      if (step.status === 'running' || step.status === 'pending') {
        step.status = 'completed';
      }
    });
  };

  for (const event of sortedEvents) {
    const stateName = event.state_name ?? '';
    
    // First try exact match via mapping
    const mappedStep = STATE_NAME_TO_STEP[stateName];
    if (mappedStep) {
      const stepIndex = WORKFLOW_STEPS.indexOf(mappedStep);
      if (stepIndex !== -1) {
        updateStep(stepIndex, event);
        continue;
      }
    }
    
    // Fallback: check if state name contains any step name
    const stepIndex = WORKFLOW_STEPS.findIndex(step => stateName.includes(step));
    if (stepIndex !== -1) {
      updateStep(stepIndex, event);
    }
  }

  const completedSteps = steps.filter(s => s.status === 'completed').length;
  const runningStepIndex = steps.findIndex(s => s.status === 'running');
  const progress = Math.round((completedSteps / WORKFLOW_STEPS.length) * 100);

  return {
    status: execution.status,
    startDate: execution.start_date,
    endDate: execution.stop_date,
    duration: calculateDuration(execution.start_date, execution.stop_date),
    steps,
    events: execution.events,
    logs: execution.events,
    currentStep: runningStepIndex >= 0 ? WORKFLOW_STEPS[runningStepIndex] : undefined,
    progress,
  };
}
